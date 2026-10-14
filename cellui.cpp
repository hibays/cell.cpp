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
#include "cell.cpp"

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
    };
    static state g_state;

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
    static void reveal_in_shell(const std::string &path)
    {
        std::error_code ec;
        auto abs = std::filesystem::absolute(path, ec);
        if (ec)
            return;
#ifdef _WIN32
        std::wstring w(abs.wstring());
        ShellExecuteW(nullptr, L"explore", w.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
#elif defined(__APPLE__)
        std::string cmd = "open -R '" + abs.string() + "'";
        const int rc = std::system(cmd.c_str()); // best effort shell integration
        (void)rc;
#else
        std::string cmd = "xdg-open '" + abs.parent_path().string() + "'";
        const int rc = std::system(cmd.c_str()); // best effort shell integration
        (void)rc;
#endif
    }

    static void open_external(const std::string &url)
    {
#ifdef _WIN32
        std::wstring w(url.begin(), url.end());
        ShellExecuteW(nullptr, L"open", w.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
#elif defined(__APPLE__)
        std::string cmd = "open '" + url + "'";
        const int rc = std::system(cmd.c_str()); // best effort shell integration
        (void)rc;
#else
        std::string cmd = "xdg-open '" + url + "'";
        const int rc = std::system(cmd.c_str()); // best effort shell integration
        (void)rc;
#endif
    }

    // ---- native bridge (bound JS functions) -----------------------------------
    // webui_return_string takes a const char*: keep the dump alive across the call
    static void reply_json(webui_event_t *e, const nlohmann::json &j)
    {
        const std::string s = j.dump();
        webui_return_string(e, s.c_str());
    }

    static void bind_hello(webui_event_t *e)
    {
        webui_return_string(e, "cell native bridge ok");
    }

    static void bind_bootstrap(webui_event_t *e)
    {
        // Everything the front-end needs to talk to the in-process agent.
        nlohmann::json j{
            {"version", CELL_VERSION},
            {"serve_ok", g_state.serve_ok.load()},
            {"serve_error", g_state.serve_error},
            {"uptime_s", (long long)std::time(nullptr) - g_state.started_at},
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
                                        ? std::filesystem::current_path() / std::format("cell-{}.html", sanitize_filename(sid))
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
                    std::filesystem::path out = std::filesystem::current_path() /
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
            std::filesystem::path out = std::filesystem::current_path() / std::format("cell-{}.html", sanitize_filename(sid));
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
        if (p != nullptr && *p)
            reveal_in_shell(p);
        webui_return_string(e, "ok");
    }

    static void bind_open_external(webui_event_t *e)
    {
        const char *p = webui_get_string(e);
        if (p != nullptr && *p)
            open_external(p);
        webui_return_string(e, "ok");
    }

    // ---- native GUI placeholders ---------------------------------------------
    // These reserve the seam for a future native shell (native menus, tray,
    // notifications). They are intentionally trivial today: they report that the
    // native layer is present but not implemented, so the web UI can degrade
    // gracefully instead of failing.
    static void bind_native_capabilities(webui_event_t *e)
    {
        nlohmann::json j{
            {"shell", "webview2"}, // Windows: WebView2 (static loader). Others: webui default
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

    // ---- entry point -----------------------------------------------------------
    static int run(int argc, char const *argv[])
    {
        bool serve = true;
        int port = 0; // 0 = let the OS pick; the real port lands in server.json
        std::string host = "127.0.0.1";
        unsigned width = 1280, height = 860;

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
            else if (a == "--help" || a == "-h")
            {
                std::printf("usage: cellui [--size WxH] [--port N] [--host ADDR] [--no-serve]\n");
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

        // ---- the window ------------------------------------------------------
        size_t w = webui_new_window();
        webui_set_runtime(w, None); // no Deno/Node/Bun needed
        webui_set_size(w, width, height);
        webui_set_hide(w, true); // shown once the page is ready
        webui_set_port(w, 8790); // fixed local port for the window itself
        webui_set_config(show_wait_connection, false);
        webui_set_config(ui_event_blocking, false);

        webui_bind(w, "cell_hello", bind_hello);
        webui_bind(w, "cell_bootstrap", bind_bootstrap);
        webui_bind(w, "cell_export_session", bind_export_session);
        webui_bind(w, "cell_export_batch", bind_export_batch);
        webui_bind(w, "cell_export_all", bind_export_all);
        webui_bind(w, "cell_reveal", bind_reveal);
        webui_bind(w, "cell_open_external", bind_open_external);
        webui_bind(w, "cell_native_capabilities", bind_native_capabilities);
        webui_bind(w, "cell_notify", bind_notify);

#ifdef CELLUI_HAVE_EMBEDDED_WEB
        webui_show(w, cellui_web_html);
#else
        webui_show(w, kFallbackHtml);
#endif
        webui_wait(); // blocks until the window closes

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
