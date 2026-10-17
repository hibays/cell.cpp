// =============================================================================
//  cellui.cpp — the desktop front-end host for cell.cpp
//
//  A single binary that hosts the agent in a native window:
//
//    * WebUI (vendored, third_party/webui) drives the window. On Windows it
//      uses WebView2 with the loader linked *statically*
//      (third_party/webui/lib/WebView2LoaderStatic.lib), so the executable
//      needs no runtime DLLs next to it.
//    * The agent core runs in-process: cell.cpp is compiled into this
//      translation unit (CELL_NO_MAIN) and started as the RESTful service layer
//      (`cell --serve`) on a worker thread. The front-end talks to it over
//      HTTP/SSE on loopback (see docs/RESTful.md).
//    * The JS-Native bridge (`cellui_bind_*` below) exposes the capabilities a
//      web front-end cannot do itself: internal interface exports (HTML export
//      of one / many / all sessions straight through cell.cpp's renderer),
//      shell integration, and placeholders for a future native GUI.
//    * The web resources are embedded in the binary (cellui_web.h, generated
//      by scripts/embed_webui.mjs from the built front-end).
//
//  Build: see docs/BUILDING.md §"Desktop front-end (cellui)".
// =============================================================================

#define CELL_NO_MAIN // cell.cpp is linked in; this file owns the entry point
#include "../cell.cpp"

#include "webui.h"

// webui.h pulls in the Windows SDK; keep min/max out of this TU as well (the
// agent core compiled above is already guarded, this protects shell code).
#if defined(_WIN32)
#ifdef min
#undef min
#endif
#ifdef max
#undef max
#endif
#endif

// The generated embedding header (scripts/embed_webui.mjs). When the front-end
// has not been built yet the build falls back to CELLUI_FALLBACK_HTML below,
// so `cmake --build` always produces a runnable binary.
#ifdef CELLUI_HAVE_EMBEDDED_WEB
#include "cellui_web.h"
#endif

#include <chrono>
#include <cstring>
#include <thread>

namespace cellui
{
    // ---- fallback page (no built front-end available) -----------------------
    constexpr const char *kFallbackHtml =
        "<!doctype html><html><head><meta charset='utf-8'><title>cell</title><style>"
        "body{font-family:system-ui,sans-serif;background:#0b0f19;color:#e5e7eb;display:grid;"
        "place-items:center;height:100vh;margin:0}"
        ".card{max-width:34rem;padding:2rem;border:1px solid #1f2937;border-radius:1rem;background:#111827}"
        "h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#9ca3af;font-size:.9rem;line-height:1.6}"
        "code{background:#1f2937;padding:.15rem .4rem;border-radius:.35rem}"
        "</style></head><body><div class='card'><h1>cellui</h1>"
        "<p>The embedded web front-end was not built. Build it and re-configure:</p>"
        "<p><code>bun install &amp;&amp; bun run build</code> in <code>frontend/</code>, then re-run cmake.</p>"
        "<p>The agent service itself is running; the UI shell is the only missing piece.</p>"
        "</div></body></html>";

    // ---- runtime state -------------------------------------------------------
    struct state
    {
        std::atomic<bool> serve_ok{false};
        std::atomic<int> serve_port{0};
        std::string token;
        std::string serve_error;
        std::mutex err_m;
        long long started_at = (long long)std::time(nullptr);
        // which front-end host actually came up: webui_show_wv (WebView2) or the
        // browser fallback. Reported by the bridge, because a capability that
        // claims WebView2 inside a browser window is a lie the UI cannot see
        // through.
        std::string shell = "unknown";
    };
    static state g_state;

    // Where exports land when the caller does not name a file. The process CWD
    // is a trap for a GUI: launched from Explorer it is the executable's
    // directory (often Program Files), launched from a shell it is wherever the
    // shell happened to stand. The user's Downloads folder is the one place
    // both a file manager and a "reveal in Explorer" understand.
    static std::filesystem::path default_export_dir()
    {
        std::error_code ec;
        std::filesystem::path home;
#ifdef _WIN32
        if (const char *p = std::getenv("USERPROFILE"); p && *p)
            home = p;
#else
        if (const char *p = std::getenv("HOME"); p && *p)
            home = p;
#endif
        if (!home.empty())
        {
            std::filesystem::path downloads = home / "Downloads";
            if (std::filesystem::exists(downloads, ec))
                return downloads;
            return home;
        }
        return std::filesystem::current_path();
    }

    // Wait for .cell/server.json (written by the service layer on startup) and
    // cache the port + token for the front-end.
    static void await_server_info(const std::string &path, int timeout_ms)
    {
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);
        while (std::chrono::steady_clock::now() < deadline)
        {
            std::error_code ec;
            if (std::filesystem::exists(path, ec))
            {
                std::ifstream f(path, std::ios::binary);
                std::string text((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
                auto j = nlohmann::json::parse(text, nullptr, false);
                if (!j.is_discarded() && j.contains("port") && j.contains("token"))
                {
                    g_state.serve_port.store(j["port"].get<int>());
                    g_state.token = j["token"].get<std::string>();
                    g_state.serve_ok.store(true);
                    return;
                }
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
        std::lock_guard<std::mutex> lk(g_state.err_m);
        g_state.serve_error = "the agent service did not report a listening port in time";
    }

    // ---- internal interface bridge: HTML export ------------------------------
    // Renders one session transcript with the same self-contained renderer the
    // CLI's /export command uses (including Teamwork job panes).
    static bool export_session_html(const std::string &sid, const std::filesystem::path &out, std::string &err)
    {
        cell::async_io::flush(); // the transcript must be on disk before we read it
        cell::chat::session s(sid);
        s.load();
        cell::chat::export_context ctx;
        cell::teamwork::collect_export_jobs(sid, ctx.jobs);
        return cell::chat::export_transcript_html(s.msg(), sid, out, err, &ctx);
    }

    static std::string sanitize_filename(std::string_view in)
    {
        std::string out;
        for (char c : in)
        {
            if (c == '/' || c == '\\' || c == ':' || c == '*' || c == '?' || c == '"' || c == '<' ||
                c == '>' || c == '|' || (unsigned char)c < 0x20)
                out.push_back('_');
            else
                out.push_back(c);
        }
        if (out.size() > 80)
            out.resize(80);
        return out.empty() ? "session" : out;
    }

    // ---- shell integration ----------------------------------------------------
    // Both return false when the shell refused, so the bridge can say so
    // instead of a bare "ok" that means nothing to a caller showing a toast.
    static bool reveal_in_shell(const std::string &path)
    {
        std::error_code ec;
        auto abs = std::filesystem::absolute(path, ec);
        if (ec)
            return false;
#ifdef _WIN32
        std::wstring w(abs.wstring());
        // ShellExecuteW signals failure by returning <= 32, not by a null handle
        auto rc = reinterpret_cast<INT_PTR>(
            ShellExecuteW(nullptr, L"explore", w.c_str(), nullptr, nullptr, SW_SHOWNORMAL));
        return rc > 32;
#elif defined(__APPLE__)
        std::string cmd = "open -R '" + abs.string() + "'";
        const int rc = std::system(cmd.c_str()); // best effort shell integration
        return rc == 0;
#else
        std::string cmd = "xdg-open '" + abs.parent_path().string() + "'";
        const int rc = std::system(cmd.c_str()); // best effort shell integration
        return rc == 0;
#endif
    }

    static bool open_external(const std::string &url)
    {
#ifdef _WIN32
        std::wstring w(url.begin(), url.end());
        auto rc = reinterpret_cast<INT_PTR>(
            ShellExecuteW(nullptr, L"open", w.c_str(), nullptr, nullptr, SW_SHOWNORMAL));
        return rc > 32;
#elif defined(__APPLE__)
        std::string cmd = "open '" + url + "'";
        const int rc = std::system(cmd.c_str()); // best effort shell integration
        return rc == 0;
#else
        std::string cmd = "xdg-open '" + url + "'";
        const int rc = std::system(cmd.c_str()); // best effort shell integration
        return rc == 0;
#endif
    }

    // ---- native bridge (bound JS functions) -----------------------------------
    // webui_return_string takes a const char*: keep the dump alive across the call
    static void reply_json(webui_event_t *e, const nlohmann::json &j)
    {
        const std::string s = j.dump();
        webui_return_string(e, s.c_str());
    }

    // A throw inside a webui callback runs on webui's own thread and lands in
    // std::terminate → the whole shell (window included) vanishes. That is the
    // "window opens then silently dies" symptom. Every bound handler goes
    // through this guard so a bridge error becomes a log line + error reply.
    template <auto Handler>
    static void guarded(webui_event_t *e)
    {
        try
        {
            Handler(e);
        }
        catch (const std::exception &ex)
        {
            std::fprintf(stderr, "cellui: bridge '%s' failed: %s\n", e->element, ex.what());
            try
            {
                reply_json(e, {{"error", ex.what()}});
            }
            catch (...)
            {
            }
        }
        catch (...)
        {
            std::fprintf(stderr, "cellui: bridge '%s' failed (unknown exception)\n", e->element);
        }
    }

    static void bind_hello(webui_event_t *e)
    {
        webui_return_string(e, "cell native bridge ok");
    }

    // All-events hook (bound to the empty element). Without it the shell is
    // deaf: it never learns when the UI attached, detached or navigated, so a
    // closed window looks exactly like a hung one.
    static void bind_events(webui_event_t *e)
    {
        switch (e->event_type)
        {
            case WEBUI_EVENT_CONNECTED:
                std::fprintf(stderr, "cellui: ui connected (client %zu)\n", e->client_id);
                break;
            case WEBUI_EVENT_DISCONNECTED:
                std::fprintf(stderr, "cellui: ui disconnected (client %zu)\n", e->client_id);
                break;
            case WEBUI_EVENT_NAVIGATION:
                std::fprintf(stderr, "cellui: navigated to %s\n", e->element);
                break;
            default:
                break; // mouse clicks / callbacks are handled by their binds
        }
    }

    // Settings must survive a restart, and the default runtime root is a
    // directory *next to the executable* — read-only when cellui.exe was installed
    // into Program Files (or lives on a shared drive). Probing it and falling back
    // to a per-user location is the difference between "configure me once" and
    // "configure me again on every launch".
    static void ensure_writable_root()
    {
        if (std::getenv("CELL_ROOT"))
            return; // the caller chose the root; not ours to second-guess
        std::error_code ec;
        std::filesystem::path here = std::filesystem::path(cell::plat::executable_dir()) / ".cell";
        std::filesystem::create_directories(here, ec);
        // a directory can exist and still refuse writes, so probe with a real file
        std::filesystem::path probe = here / ".cellui-write-probe";
        {
            std::ofstream f(probe, std::ios::app);
            if (f)
                f << "x";
        }
        bool writable = std::filesystem::exists(probe, ec);
        std::filesystem::remove(probe, ec);
        if (writable)
            return;
        std::filesystem::path base;
#ifdef _WIN32
        if (const char *p = std::getenv("LOCALAPPDATA"); p && *p)
            base = p;
        else
            base = std::filesystem::temp_directory_path(ec);
#else
        if (const char *h = std::getenv("HOME"); h && *h)
            base = h;
        else
            base = std::filesystem::temp_directory_path(ec);
#endif
        std::filesystem::path fallback = base / "cell";
        std::filesystem::create_directories(fallback, ec);
#ifdef _WIN32
        _putenv_s("CELL_ROOT", fallback.string().c_str());
#else
        ::setenv("CELL_ROOT", fallback.string().c_str(), 1);
#endif
        std::fprintf(stderr,
                     "cellui: %s is not writable — settings, sessions and the vault now live in %s\n",
                     here.string().c_str(), fallback.string().c_str());
    }

    static void bind_bootstrap(webui_event_t *e)
    {
        // Everything the front-end needs to talk to the in-process agent.
        nlohmann::json j{
            {"version", CELL_VERSION},
            {"serve_ok", g_state.serve_ok.load()},
            {"serve_error", g_state.serve_error},
            {"uptime_s", (long long)std::time(nullptr) - g_state.started_at},
            // where settings, sessions and the vault live — and whether anything
            // can actually be written there. A shell that cannot save its settings
            // should say so instead of asking the user to configure it again on
            // every launch.
            {"root", cell::root.string()},
            {"root_writable", cell::root_writable()},
            // which host is actually running (webview2 / browser): the UI reads
            // this instead of assuming, and the browser fallback path stops
            // pretending to be WebView2
            {"shell", g_state.shell},
            {"platform",
             {
#ifdef _WIN32
                 "windows",
#elif defined(__APPLE__)
                 "macos",
#else
                 "linux",
#endif
                 sizeof(void *) * 8}}};
        if (g_state.serve_ok.load())
            j["api"] = nlohmann::json{{"base", std::format("http://127.0.0.1:{}/v1", g_state.serve_port.load())},
                                      {"token", g_state.token}};
        reply_json(e, j);
    }

    static void bind_export_session(webui_event_t *e)
    {
        const std::string sid = webui_get_string(e) ? webui_get_string(e) : "";
        std::string out_arg = webui_get_string_at(e, 1) ? webui_get_string_at(e, 1) : "";
        std::string err;
        std::filesystem::path out = out_arg.empty()
                                        ? default_export_dir() / std::format("cell-{}.html", sanitize_filename(sid))
                                        : std::filesystem::path(out_arg);
        if (export_session_html(sid, out, err))
            reply_json(e, nlohmann::json{{"ok", true}, {"path", out.string()}});
        else
            reply_json(e, nlohmann::json{{"ok", false}, {"error", err}});
    }

    static void bind_export_batch(webui_event_t *e)
    {
        // one JSON array argument: ["sid1", "sid2", ...]
        const char *raw = webui_get_string(e);
        nlohmann::json result = nlohmann::json::array();
        if (raw != nullptr)
        {
            auto ids = nlohmann::json::parse(raw, nullptr, false);
            if (!ids.is_discarded() && ids.is_array())
                for (auto &sid : ids)
                {
                    if (!sid.is_string())
                        continue;
                    std::string err;
                    std::filesystem::path out = default_export_dir() /
                                                std::format("cell-{}.html", sanitize_filename(sid.get<std::string>()));
                    nlohmann::json one{{"id", sid.get<std::string>()}};
                    if (export_session_html(sid.get<std::string>(), out, err))
                        one["path"] = out.string();
                    else
                        one["error"] = err;
                    result.push_back(std::move(one));
                }
        }
        reply_json(e, result);
    }

    static void bind_export_all(webui_event_t *e)
    {
        // every session on disk, newest first
        cell::async_io::flush();
        nlohmann::json result = nlohmann::json::array();
        std::vector<std::pair<std::string, long long>> sids; // id -> mtime
        std::error_code ec;
        std::filesystem::path dir = cell::root / "sessions";
        for (auto &g : std::filesystem::directory_iterator(dir, ec))
        {
            if (ec)
                break;
            if (!g.is_directory(ec))
                continue;
            for (auto &f : std::filesystem::directory_iterator(g.path(), ec))
            {
                if (ec)
                    break;
                if (!f.is_directory(ec))
                    continue;
                std::filesystem::path tf = f.path() / "messages.jsonl";
                if (!std::filesystem::exists(tf, ec))
                    continue;
                auto mt = std::filesystem::last_write_time(tf, ec).time_since_epoch().count();
                sids.emplace_back(f.path().filename().string(), (long long)mt);
            }
        }
        std::sort(sids.begin(), sids.end(), [](auto &a, auto &b) { return a.second > b.second; });
        for (auto &[sid, mt] : sids)
        {
            std::string err;
            std::filesystem::path out = default_export_dir() / std::format("cell-{}.html", sanitize_filename(sid));
            nlohmann::json one{{"id", sid}};
            if (export_session_html(sid, out, err))
                one["path"] = out.string();
            else
                one["error"] = err;
            result.push_back(std::move(one));
        }
        reply_json(e, result);
    }

    static void bind_reveal(webui_event_t *e)
    {
        const char *p = webui_get_string(e);
        if (p == nullptr || !*p)
        {
            reply_json(e, nlohmann::json{{"ok", false}, {"error", "reveal: no path given"}});
            return;
        }
        if (reveal_in_shell(p))
            reply_json(e, nlohmann::json{{"ok", true}});
        else
            reply_json(e, nlohmann::json{{"ok", false}, {"error", "the file manager did not open"}});
    }

    static void bind_open_external(webui_event_t *e)
    {
        const char *p = webui_get_string(e);
        if (p == nullptr || !*p)
        {
            reply_json(e, nlohmann::json{{"ok", false}, {"error", "open: no url given"}});
            return;
        }
        if (open_external(p))
            reply_json(e, nlohmann::json{{"ok", true}});
        else
            reply_json(e, nlohmann::json{{"ok", false}, {"error", "no application accepted the url"}});
    }

    // ---- native GUI placeholders ---------------------------------------------
    // These reserve the seam for a future native shell (native menus, tray,
    // notifications). They are intentionally trivial today: they report that the
    // native layer is present but not implemented, so the web UI can degrade
    // gracefully instead of failing.
    static void bind_native_capabilities(webui_event_t *e)
    {
        nlohmann::json j{
            // the host that actually came up, not the one we hoped for: on the
            // browser-fallback path this reads "browser", so the UI never
            // offers a WebView-only affordance inside someone else's window
            {"shell", g_state.shell},
            {"native_menu", false},
            {"tray", false},
            {"notifications", false},
            {"file_dialog", "web"}};
        reply_json(e, j);
    }

    static void bind_notify(webui_event_t *e)
    {
        // Placeholder: a future native toast. Today the web UI renders its own.
        const char *p = webui_get_string(e);
        (void)p;
        reply_json(e, nlohmann::json{{"delivered", false}, {"reason", "native notifications are not implemented; use the in-app toast"}});
    }

    // WebUI serves the embedded SPA for "/" verbatim and does NOT auto-inject
    // its native bridge. The page must reference /webui.js itself, otherwise
    // window.cell_bootstrap (and every other bind) is undefined and the front-end
    // boot() throws "native bridge unavailable" → the GUI reports "kernel not
    // ready" even though the in-process agent service started fine. Inject the
    // bridge load if the page does not already have it.
    static std::string with_webui_bridge(std::string html)
    {
        if (html.find("/webui.js") != std::string::npos)
            return html; // already wired (defensive against double-injection)
        constexpr const char *kTag = "\n<script src=\"/webui.js\"></script>\n";
        size_t pos = html.find("</head>");
        if (pos != std::string::npos)
            html.insert(pos, kTag);
        else if ((pos = html.find("<head>")) != std::string::npos)
            html.insert(pos + 6, kTag);
        else if ((pos = html.find("</body>")) != std::string::npos)
            html.insert(pos, kTag);
        else
            html = std::string{kTag} + html;
        return html;
    }

    // ---- window icon -----------------------------------------------------------
    // The brand mark is compiled into this executable by the resource compiler
    // (assets/brand/win/cellui.rc.in), so it travels *inside* the single file —
    // the same idea as the DSHL shell embedding packing/windows/dsh.ico as
    // resource 101, and the reason no `brand/cell.ico` has to sit next to the
    // binary. It must stay in step with IDI_CELL_ICON in that .rc.
    constexpr int kCellIconId = 101;
    // Three places carry this number: this constant, IDI_CELL_ICON in both .rc
    // files, and EXPECTED in tests/cellui_smoke.py. The smoke test pins the id
    // *inside the built binary* (so the .rc side cannot drift); this pins the
    // C++ side, because a drift here would leave a binary whose resource is
    // perfectly fine and whose LoadImage silently fails — no headless test can
    // see that, so both ends fail loudly instead: a compile error here, a red
    // test there.
    static_assert(kCellIconId == 101,
                  "kCellIconId must match IDI_CELL_ICON in assets/brand/win/{cell,cellui}.rc.in "
                  "and EXPECTED in tests/cellui_smoke.py");

#ifdef _WIN32
    // webui cannot do this on Windows: webui_set_icon_file() only hands the
    // bytes to the GTK back-end and is inert here, so the Win32 window gets the
    // icon directly.
    //
    // Two loads at the metric sizes — ICON_BIG is the taskbar / Alt-Tab image,
    // ICON_SMALL the titlebar one, and a multi-size .ico gives each its crisp
    // bitmap. The handles are deliberately never destroyed: Windows does not
    // copy them, and the window outlives every other interest in this process.
    static void apply_window_icon(size_t window)
    {
        HWND hwnd = static_cast<HWND>(webui_win32_get_hwnd(window));
        if (hwnd == nullptr)
            return; // no Win32 window yet
        // Only a window of ours may be touched. In the browser fallback webui
        // hands back the *browser's* window, and an HICON is a per-process
        // handle: that process could not use one of ours, so this path stays
        // icon-less instead of parking a handle that means nothing over there.
        DWORD owner = 0;
        GetWindowThreadProcessId(hwnd, &owner);
        if (owner != GetCurrentProcessId())
            return;
        HINSTANCE hinst = GetModuleHandleW(nullptr);
        auto load = [hinst](int cx, int cy) -> HICON
        {
            return static_cast<HICON>(
                LoadImageW(hinst, MAKEINTRESOURCEW(kCellIconId), IMAGE_ICON, cx, cy, 0));
        };
        // Not `big`/`small`: the Windows SDK's rpcndr.h still carries the MIDL
        // legacy `#define small char`, so `HICON small = …` reaches the compiler
        // as `HICON char = …` and MSVC rejects the file. MinGW defines nothing
        // of the sort, which is how the first version of this code built cleanly
        // here and failed only in ci.yml's MSVC job.
        HICON icon_big = load(GetSystemMetrics(SM_CXICON), GetSystemMetrics(SM_CYICON));
        HICON icon_small = load(GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON));
        if (icon_big == nullptr && icon_small == nullptr)
        {
            std::fprintf(stderr, "cellui: this executable has no icon resource %d (see assets/brand/win/cellui.rc.in)\n",
                         kCellIconId);
            return;
        }
        if (icon_big != nullptr)
            SendMessageW(hwnd, WM_SETICON, ICON_BIG, reinterpret_cast<LPARAM>(icon_big));
        if (icon_small != nullptr)
            SendMessageW(hwnd, WM_SETICON, ICON_SMALL, reinterpret_cast<LPARAM>(icon_small));
    }
#else
    static void apply_window_icon(size_t) {} // Linux: webui_set_icon_file; macOS: bundle icon
#endif

    // A GTK window picks up its icon while it is being created, so the file has
    // to be handed over before the first show. webui resolves the path against
    // the working directory and then the executable's directory, and silently
    // ignores it when neither holds the file — so a portable copy of the binary
    // without the brand directory still opens, just with the default icon.
    static void prime_window_icon(size_t window)
    {
#if defined(__linux__)
        webui_set_icon_file(window, "brand/png/cell-192.png");
#else
        (void)window;
#endif
    }

    // ---- entry point -----------------------------------------------------------
    static int run(int argc, char const *argv[])
    {
        bool serve = true;
        int port = 0; // 0 = let the OS pick; the real port lands in server.json
        std::string host = "127.0.0.1";
        unsigned width = 1280, height = 860;
        bool force_browser = false;

        // cellui accepts a small flag set of its own; everything else is passed
        // through to the agent CLI.
        std::vector<std::string> passthrough{"cell", "--serve", "--no-color"};
        for (int i = 1; i < argc; i++)
        {
            std::string a = argv[i];
            auto next = [&](const char *name) -> std::string
            {
                if (i + 1 >= argc)
                {
                    std::fprintf(stderr, "cellui: missing value for %s\n", name);
                    std::exit(1);
                }
                return argv[++i];
            };
            if (a == "--no-serve")
                serve = false;
            else if (a == "--port")
                port = std::atoi(next("--port").c_str());
            else if (a == "--host")
                host = next("--host");
            else if (a == "--size")
            {
                std::string w = next("--size");
                auto x = w.find('x');
                if (x == std::string::npos)
                    x = w.find('X');
                if (x != std::string::npos)
                {
                    width = (unsigned)std::atoi(w.substr(0, x).c_str());
                    height = (unsigned)std::atoi(w.substr(x + 1).c_str());
                }
            }
            else if (a == "--browser")
                force_browser = true;
            else if (a == "--help" || a == "-h")
            {
                std::printf("usage: cellui [--size WxH] [--port N] [--host ADDR] [--no-serve] [--browser]\n"
                            "  default opens a WebView2 native window (falls back to a browser\n"
                            "  app-window if the WebView is unavailable); --browser skips it\n");
                return 0;
            }
            else
                passthrough.push_back(a);
        }
        if (serve)
        {
            passthrough.push_back("--port");
            passthrough.push_back(std::to_string(port));
            passthrough.push_back("--host");
            passthrough.push_back(host);
        }

        // before anything touches cell::root: it is initialised on first use, and
        // the fallback has to be in place by then
        ensure_writable_root();

        // start the agent service layer in this process
        std::thread serve_thread;
        if (serve)
        {
            std::vector<char const *> argv_c;
            for (auto &s : passthrough)
                argv_c.push_back(s.c_str());
            argv_c.push_back(nullptr);
            serve_thread = std::thread([argv = std::move(argv_c)]() mutable
                                       {
                int rc = cell_main((int)argv.size() - 1, argv.data());
                std::lock_guard<std::mutex> lk(g_state.err_m);
                g_state.serve_error = std::format("agent service exited with code {}", rc);
                g_state.serve_ok.store(false); });
            await_server_info((cell::root / "server.json").string(), 15000);
            if (!g_state.serve_ok.load())
                std::fprintf(stderr, "cellui: %s\n", g_state.serve_error.c_str());
        }

        // ---- display scaling (Windows high-DPI) -------------------------------
        // Without a DPI-awareness declaration the process is system-DPI-unaware:
        // DWM bitmap-stretches the window → blurry text and a physically wrong
        // size on 125/150 % displays. Per-monitor-v2 keeps the WebView crisp,
        // and the requested size is then interpreted in physical pixels, so the
        // logical size is scaled by the monitor's factor here.
#ifdef _WIN32
        {
            if (HMODULE user32 = GetModuleHandleW(L"user32.dll"))
            {
                using SetCtxFn = BOOL(WINAPI *)(DPI_AWARENESS_CONTEXT);
                // GetProcAddress returns FARPROC; routing the cast through
                // void(*)() is what satisfies -Wcast-function-type (GCC treats
                // that one function type as matching everything), so the strict
                // -Werror build dirs compile this file too — this cast used to
                // be the only thing that failed, and only when some other
                // change forced cellui.cpp to recompile there.
                auto proc = reinterpret_cast<void (*)()>(
                    GetProcAddress(user32, "SetProcessDpiAwarenessContext"));
                if (auto set_ctx = reinterpret_cast<SetCtxFn>(proc); set_ctx != nullptr)
                {
                    set_ctx(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
                }
            }
            HDC dc = GetDC(nullptr);
            if (dc != nullptr)
            {
                UINT dpi = GetDeviceCaps(dc, LOGPIXELSX); // 96 = 100 %
                ReleaseDC(nullptr, dc);
                if (dpi > 96)
                {
                    // exact rational scale (144 -> 1.5x): integer division would
                    // round 1.5 down to 1 and the window would come out tiny
                    // while the WebView lays out at 1.5 — clipped, oversized UI
                    width = (unsigned)(((unsigned long long)width * dpi + 48) / 96);
                    height = (unsigned)(((unsigned long long)height * dpi + 48) / 96);
                }
            }
        }
#endif

        // ---- the window ------------------------------------------------------
        // WebView2 native window is the product (user's chosen path); the
        // app-mode browser window is the fallback. WebUI's show() outcomes vary
        // with how the process was started (console / detached / redirected
        // handles), so return codes alone are never trusted — the supervisor
        // below watches for a VISIBLE top-level window of this pid instead.
        size_t w = webui_new_window();
        webui_set_runtime(w, None); // no Deno/Node/Bun needed
        webui_set_size(w, width, height);
        // NOTE: do NOT call webui_set_hide() — it starts the window in hidden
        // mode and the window would never become visible.
        // no fixed port: if the port is busy, webui would fail to show it
        webui_set_timeout(60); // cold browser/WebView start needs more than 15s
        prime_window_icon(w);  // Linux/GTK only, and only before the first show

        // Hook the full event stream (connected / disconnected / navigation /
        // callback) so the shell reacts to the UI instead of only answering
        // calls. Binding to the empty element installs the all-events handler.
        webui_bind(w, "", bind_events);

        webui_bind(w, "cell_hello", guarded<bind_hello>);
        webui_bind(w, "cell_bootstrap", guarded<bind_bootstrap>);
        webui_bind(w, "cell_export_session", guarded<bind_export_session>);
        webui_bind(w, "cell_export_batch", guarded<bind_export_batch>);
        webui_bind(w, "cell_export_all", guarded<bind_export_all>);
        webui_bind(w, "cell_reveal", guarded<bind_reveal>);
        webui_bind(w, "cell_open_external", guarded<bind_open_external>);
        webui_bind(w, "cell_native_capabilities", guarded<bind_native_capabilities>);
        webui_bind(w, "cell_notify", guarded<bind_notify>);

#ifdef CELLUI_HAVE_EMBEDDED_WEB
        // the payload arrives as chunks (MSVC caps any single literal at
        // ~16380 bytes); cellui_web_html() stitches them back together
        std::string html = cellui_web_html();
#else
        std::string html = std::string{kFallbackHtml};
#endif
        // wire the WebUI native bridge (window.cell_bootstrap, …) into the page
        html = with_webui_bridge(std::move(html));

        bool shown = false;
        if (!force_browser)
        {
            shown = webui_show_wv(w, html.c_str());
            if (shown)
                g_state.shell = "webview2";
            if (!shown)
                std::fprintf(stderr,
                             "cellui: WebView2 did not open (runtime missing, %%TEMP%% unwritable,\n"
                             "        full disk, or no interactive desktop session) — falling back…\n");
        }
        if (!shown)
        {
            // app-mode browser window: the path DSHL ships on
            shown = webui_show_browser(w, html.c_str(), AnyBrowser);
            if (shown)
                g_state.shell = "browser";
        }
        if (!shown && !force_browser)
        {
            // webui's show() outcome depends on how this process was started
            // (console / detached / redirected handles); one retry is cheap
            shown = webui_show_wv(w, html.c_str());
            if (shown)
                g_state.shell = "webview2";
        }
        if (!shown)
        {
            std::fprintf(stderr,
                         "cellui: no window could be opened. Start 'cell --serve' from the same\n"
                         "        directory and open the printed URL instead.\n");
            if (serve_thread.joinable())
                serve_thread.join();
            return 2;
        }

        // The window exists now, so give it the brand mark: without this the
        // titlebar and Alt-Tab show whatever WebView2/webui left behind. The
        // window is already *visible* by the time this runs — it appears ~0.7s
        // earlier, while the WebView thread is still creating the WebView2
        // environment (webui_show_wv returns only after that, and under load it
        // takes longer), so the default icon is briefly on screen. Unavoidable
        // from here: the icon cannot be applied before webui_win32_get_hwnd()
        // has a window to apply it to.
        apply_window_icon(w);

        // ---- window supervisor (DSHL src/ui/browser.rs, condensed) -------------
        // webui return codes are not ground truth. The invariant that holds:
        // "the UI is up" ⇔ a VISIBLE top-level window of THIS pid exists. Poll
        // it; once seen and then gone for 3s, tear webui down so wait() returns
        // instead of the shell lingering headless (or dying with it).
        std::atomic<bool> stop_monitor{false};
        std::thread monitor;
#ifdef _WIN32
        monitor = std::thread([&]
                            {
            struct Scan
            {
                DWORD pid;
                bool found;
            };
            int misses = 0;
            bool seen = false;
            while (!stop_monitor.load(std::memory_order_relaxed))
            {
                Scan scan{GetCurrentProcessId(), false};
                EnumWindows(
                    [](HWND h, LPARAM l) -> BOOL
                    {
                        auto *s = reinterpret_cast<Scan *>(l);
                        DWORD pid = 0;
                        GetWindowThreadProcessId(h, &pid);
                        if (pid != s->pid)
                            return TRUE;
                        wchar_t title[64];
                        if (IsWindowVisible(h) && GetWindowTextW(h, title, 64) > 0 &&
                            wcscmp(title, L"cell") == 0)
                        {
                            s->found = true;
                            return FALSE;
                        }
                        return TRUE;
                    },
                    reinterpret_cast<LPARAM>(&scan));
                if (scan.found)
                {
                    seen = true;
                    misses = 0;
                }
                else if (seen && ++misses >= 6) // 6 × 500ms without a window
                {
                    webui_exit();
                    return;
                }
                std::this_thread::sleep_for(std::chrono::milliseconds(500));
            } });
#endif // _WIN32
        // POSIX: the X11/Wayland counterpart needs a display connection of its
        // own; there the exit hook (bind_events → disconnected) covers teardown.

        webui_wait(); // blocks until the window closes (or the supervisor exits it)
        stop_monitor.store(true);
        if (monitor.joinable())
            monitor.join();
        webui_exit(); // canonical teardown: stop servers, wake webui_wait()
        webui_clean();

        if (serve)
        {
            // ask the in-process service layer to stop, then join it
            std::thread([port = g_state.serve_port.load(), token = g_state.token]()
                        {
                if (port > 0)
                {
                    std::string url = std::format("http://127.0.0.1:{}/v1/shutdown", port);
                    std::string cmd;
#ifdef _WIN32
                    cmd = std::format("powershell -NoProfile -Command \"try{{(Invoke-WebRequest -Uri '{}' -Method POST -Headers @{{Authorization='Bearer {}'}} -UseBasicParsing).StatusCode}}catch{{}}\"", url, token);
#else
                    cmd = std::format("curl -s -o /dev/null -X POST -H 'Authorization: Bearer {}' '{}'", token, url);
#endif
                    const int rc = std::system(cmd.c_str()); // best effort shell integration
                    (void)rc;
                } })
                .detach();
            std::this_thread::sleep_for(std::chrono::milliseconds(500));
        }
        if (serve_thread.joinable())
            serve_thread.join();
        return 0;
    }
} // namespace cellui

int main(int argc, char const *argv[])
{
    return cellui::run(argc, argv);
}
