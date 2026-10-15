# Building cell.cpp

cell.cpp is a **single-translation-unit** project: the entire agent lives in
`cell.cpp`. There are two supported ways to build it:

| Path | When to use it |
| --- | --- |
| **Raw compiler command** | Quick one-off builds, embedding into exotic build systems. Nothing beyond a C++26 toolchain + 3 libraries. |
| **CMake** | Everything else: reproducible builds, CI, packaging, the shared library (DLL) for desktop app integration, `find_package()` consumption. |

The CMake build is purely additive — it never changes how the raw command works.

---

## 1. Prerequisites

### Toolchain

cell.cpp needs a **C++26 toolchain with a recent standard library** — specifically
`<format>`, `<expected>`, `<generator>`, `<span>`, `<concepts>` and
`std::move_only_function`. This is bleeding-edge: use a current compiler, not an LTS one.

| Toolchain | Minimum | Recommended | Note |
| --- | --- | --- | --- |
| GCC | 14 | **15+** | `<generator>` needs GCC 14's libstdc++ |
| Clang + libstdc++ | 17 | **19+** | needs `-fsized-deallocation` for libstdc++'s `<generator>` — **CMake adds it automatically** |
| Clang + libc++ | 19 | 19+ | `<generator>` landed in libc++ 19 |
| MSVC | 19.40 (VS 2022 17.10) | **17.12+** | builds with `/std:c++latest` |
| AppleClang (Xcode) | 16.3 | 16.3+ | libc++ with `<generator>` |

CMake does not guess: it **compiles a probe** using exactly those features and
fails with an actionable message when the toolchain cannot handle them
(`-DCELL_TOOLCHAIN_CHECKS=OFF` bypasses the probe). When the probe fails only
because of the known Clang/sized-deallocation quirk, the build self-heals by
appending `-fsized-deallocation` (raw compiler users must add that flag
themselves).

### Libraries

| Dependency | Kind | vcpkg | MSYS2 (UCRT64) | Debian/Ubuntu | Fedora | macOS |
| --- | --- | --- | --- | --- | --- | --- |
| libcurl | link | `curl` | `mingw-w64-ucrt-x86_64-curl` | `libcurl4-openssl-dev` | `libcurl-devel` | system / `brew install curl` |
| libsodium | link | `libsodium` | `mingw-w64-ucrt-x86_64-libsodium` | `libsodium-dev` | `libsodium-devel` | `brew install libsodium` |
| nlohmann/json | header-only | `nlohmann-json` | `mingw-w64-ucrt-x86_64-nlohmann-json` | `nlohmann-json3-dev` | `json-devel` | `brew install nlohmann-json` |

A `vcpkg.json` manifest ships in the repository, so with vcpkg toolchain mode the
three dependencies install themselves during the first configure.

### Build tools

CMake **3.21+** (4.x recommended) and any generator — Ninja, Make, Visual
Studio, Xcode. `ninja` is used in all examples because it is the fastest.

---

## 2. Quick start

### MSYS2 UCRT64 (Windows, GCC)

```bash
pacman -S mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-cmake \
          mingw-w64-ucrt-x86_64-ninja mingw-w64-ucrt-x86_64-curl \
          mingw-w64-ucrt-x86_64-libsodium mingw-w64-ucrt-x86_64-nlohmann-json

cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build
ctest --test-dir build --output-on-failure
```

Artifacts: `build/bin/cell.exe`, `build/bin/cell.dll`, `build/lib/libcell.dll.a`.

### Visual Studio 2022 (Windows, MSVC + vcpkg)

```bat
:: from a Developer Command Prompt, with VCPKG_ROOT set
cmake -S . -B build -G "Visual Studio 17 2022" -A x64 ^
  -DCMAKE_TOOLCHAIN_FILE="%VCPKG_ROOT%\scripts\buildsystems\vcpkg.cmake"
cmake --build build --config Release --parallel
ctest --test-dir build -C Release --output-on-failure
```

`vcpkg.json` installs curl / nlohmann-json / libsodium automatically.

### Linux (GCC)

```bash
sudo apt install g++-14 ninja-build libcurl4-openssl-dev libsodium-dev nlohmann-json3-dev
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_CXX_COMPILER=g++-14
cmake --build build && ctest --test-dir build --output-on-failure
```

### macOS (AppleClang)

```bash
brew install ninja libsodium nlohmann-json      # system curl is used
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build && ctest --test-dir build --output-on-failure
```

### One-liner without CMake (still supported)

```bash
# Linux / macOS
g++ -std=c++26 -O2 -o cell cell.cpp -lcurl -lsodium

# Windows (MinGW): + ws2_32 for the built-in HTTP server of `cell --serve`
g++ -std=c++26 -O2 -o cell cell.cpp -lcurl -lsodium -lws2_32
```

---

## 3. Build options

All options are cache variables: `-D<OPTION>=ON|OFF` at configure time.

| Option | Default | Meaning |
| --- | --- | --- |
| `CELL_BUILD_CLI` | `ON` | Build the `cell` command-line executable |
| `CELL_BUILD_SHARED` | `ON` | Build the shared library (`cell.dll` / `libcell.so` / `libcell.dylib`) |
| `CELL_BUILD_STATIC` | `OFF` | Build the static library (for apps that link cell in) |
| `CELL_BUILD_TESTS` | `ON` | Register ctest tests (self-test + embedding smoke test) |
| `CELL_INSTALL` | `ON` | Install rules + CMake package (`find_package(cell)`) |
| `CELL_FETCH_DEPS` | `ON` | Fetch nlohmann/json (header-only) when not installed |
| `CELL_ENABLE_WARNINGS` | `ON` | `-Wall -Wextra` / `/W4 /permissive-` |
| `CELL_WARNINGS_AS_ERRORS` | `OFF` | `-Werror` / `/WX` (recommended in CI) |
| `CELL_ENABLE_LTO` | `OFF` | Interprocedural optimization in Release (single TU: little gain, slower builds) |
| `CELL_ENABLE_ASAN` | `OFF` | AddressSanitizer + UBSan (GCC/Clang) or `/fsanitize=address` (MSVC); configure fails with a clear message if the toolchain ships no sanitizer runtime |
| `CELL_TOOLCHAIN_CHECKS` | `ON` | Compile-probe the standard library; fail fast with guidance |
| `CELL_MINGW_STATIC_RUNTIME` | `ON` | MinGW: link libgcc/libstdc++ statically into the binaries |
| `CELL_CXX_STANDARD` | `26` | C++ standard level (needs a CMake that understands the value) |
| `CELL_VERSION_STRING` | `0.1.0` | String compiled into `cell_version()`; CI can inject a tag |

### Presets

`CMakePresets.json` ships ready-made configurations — `cmake --list-presets`:

| Preset | What it builds |
| --- | --- |
| `default` | Release, CLI + shared library, tests |
| `debug` | Debug build |
| `ci` | Release + warnings-as-errors + static library (what CI runs) |
| `asan` | Debug with ASan + UBSan |
| `release-lto` | Release with LTO + static library (packaging) |
| `desktop-dll` | **Shared library only** — for desktop front-ends |
| `static-embed` | Static library only |
| `windows-msvc` | VS 2022 + vcpkg toolchain |
| `windows-msys2-gcc` / `windows-msys2-clang` | MSYS2 UCRT64 |
| `macos-clang` / `linux-gcc` | native toolchains |

```bash
cmake --preset desktop-dll && cmake --build --preset desktop-dll
ctest --preset default            # runs self-test + smoke test
```

---

## 4. Targets and artifacts

| CMake target | Artifact | Windows | Linux / macOS |
| --- | --- | --- | --- |
| `cell_cli` (`cell::cli`) | executable | `build/bin/cell.exe` | `build/bin/cell` |
| `cell_shared` (`cell::shared`) | shared library | `build/bin/cell.dll` + `build/lib/libcell.dll.a` (MinGW) or `cell.lib` (MSVC) | `build/bin/libcell.so.0.1.0` (+ symlinks) / `libcell.0.1.0.dylib` |
| `cell_static` (`cell::static`) | static library | `build/lib/libcell.a` (MinGW) / `cell-static.lib` (MSVC) | `build/lib/libcell.a` |

Everything lands in `build/bin` (runtime) and `build/lib` (link-time) regardless
of configuration, so the DLL sits next to the test executables and Windows finds
it without PATH surgery.

---

## 5. The shared library (DLL) — desktop integration

`cell.cpp` compiles into a self-contained shared library that exports a small,
stable, `extern "C"` surface declared in [`include/cell.h`](../include/cell.h):

| Function | Purpose |
| --- | --- |
| `cell_version()` | build identity string |
| `cell_selftest()` | run the built-in test suite (0 = all passed) |
| `cell_main(argc, argv)` | run the full CLI in-process (same code path as the exe) |
| `cell_run_oneshot(message, &reply)` | **one message → one complete agent turn → captured output text** — the pragmatic way for a GUI to talk to the agent today |
| `cell_free(ptr)` | release strings returned by `cell_run_oneshot` |

Build it with:

```bash
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release \
      -DCELL_BUILD_CLI=OFF -DCELL_BUILD_SHARED=ON -DCELL_BUILD_STATIC=OFF
cmake --build build
```

### Consuming it

**a) CMake (recommended)** — after `cmake --install` (or `ctest`-verified local build):

```cmake
find_package(cell CONFIG REQUIRED)
target_link_libraries(my_gui PRIVATE cell::shared)   # or cell::static
target_compile_definitions(my_gui PRIVATE CELL_USE_SHARED) # set automatically by the target
```

`cell::shared` carries the include directory and the import-library linkage; the
`CELL_USE_SHARED` definition (which selects `__declspec(dllimport)`) is applied
automatically.

**b) MSVC, manual**

```bat
cl my_gui.cpp /std:c++latest /I<prefix>\include /link cell.lib
:: ship cell.dll next to my_gui.exe
```

**c) MinGW, manual**

```bash
gcc my_gui.c -I<prefix>/include -L<prefix>/lib -lcell.dll.a
# gcc (the C compiler) works too — the API is plain extern "C"
```

**d) Any other language** — the ABI is pointers-and-ints only:
C# (`DllImport`), Python (`ctypes.CDLL("cell.dll")`), Rust (`extern "C"`), etc.

### Minimal C example

```c
#include "cell.h"
#include <stdio.h>

int main(void)
{
    char *reply = NULL;
    int rc = cell_run_oneshot("explain what this repo does", &reply);
    if (reply) { printf("rc=%d\n%s\n", rc, reply); cell_free(reply); }
    return rc;
}
```

### What to ship with a desktop app

The MinGW build links libgcc/libstdc++ statically
(`CELL_MINGW_STATIC_RUNTIME=ON`, optimized configurations only — Debug builds
keep the dynamic runtime, see §11) and picks up the static curl/sodium archives
that MSYS2's `curl`/`libsodium` packages install, so `cell.dll` depends on **only
Windows system DLLs**. That was verified with `objdump -p cell.dll`:
`KERNEL32`, `ADVAPI32`, `api-ms-win-crt-*` — no `libcurl.dll`, no
`libsodium.dll`, no `libstdc++-6.dll`.

For a fully standalone deployment on MSVC, use vcpkg's static triplet:

```bat
cmake -S . -B build -G "Visual Studio 17 2022" -A x64 ^
  -DCMAKE_TOOLCHAIN_FILE=%VCPKG_ROOT%\scripts\buildsystems\vcpkg.cmake ^
  -DVCPKG_TARGET_TRIPLET=x64-windows-static
```

> **Threading contract** — the agent CLI owns process-global state (signal
> handlers, console mode, stdio, current working directory). All entry points
> serialize on one process-wide lock: call them from a single worker thread,
> never concurrently. `cell_run_oneshot` temporarily redirects stdio, so do not
> write to stdout from other threads while it runs.

> **Approvals** — `cell_run_oneshot` cannot prompt (captured stdin is not a
> terminal), so `Policy::Ask` tool calls (notably `exec`) are refused —
> fail-closed. Enable `autoallow` for full-access runs, or drive the CLI via
> `cell_main` when interactive approvals are needed.

---

## 6. Service layer (`cell --serve`)

The same binary can host the RESTful service layer described in
[RESTful.md](RESTful.md) — a dependency-free HTTP/1.1 + SSE server with bearer
token auth, session management, turn streaming and HTTP approvals:

```bash
cell --serve                      # 127.0.0.1:8737, random token
cell --serve --port 0             # pick a free port (prints it; useful for tests)
cell --serve --host 0.0.0.0 --token "$MY_TOKEN"
```

* Discovery file: `.cell/server.json` **next to the binary** (the runtime root
  is portable and follows the executable, not the working directory).
* On Windows the server uses **Winsock 2**, so the raw single-file build needs
  one more library:

  ```bash
  # Windows (MinGW / MSYS2)
  g++ -std=c++26 -O2 -o cell cell.cpp -lcurl -lsodium -lws2_32

  # Linux / macOS (sockets live in libc — unchanged)
  g++ -std=c++26 -O2 -o cell cell.cpp -lcurl -lsodium
  ```

  The CMake build links `ws2_32` automatically (`cell_configure_target`).
* No new dependencies, no new targets: `--serve` is a mode of the same
  executable, and the library/embedding builds (`cell.dll`, `cell_static`)
  carry the same code.

---

## 7. Desktop front-end (cellui)

`cellui` is the desktop shell: one portable binary that hosts the agent in a
native window.

| Piece | Where | Notes |
| --- | --- | --- |
| WebUI driver | `webui/third_party/webui/` (vendored sources) | compiled from source; **WebView2 with a statically linked loader** on Windows (`webui/third_party/webui/lib/WebView2LoaderStatic.lib`), WKWebView on macOS, webui's browser backend on Linux |
| Native bridge | `webui/cellui.cpp` | starts the service layer in-process (`cell_main("--serve")` on a worker thread), binds `cell_*` functions to JS, and bridges the **internal** HTML exporter for session/batch/full exports |
| Front-end | `frontend/` (Vue 3 + TS + Vite) | built to a single HTML file and **embedded into the binary** (`webui/scripts/embed_webui.mjs` → `cellui_web.h`) |
| Window icon | `assets/brand/win/cellui.rc.in` | the brand mark is embedded as icon resource **101** and handed to the window with `WM_SETICON` (`apply_window_icon` in `cellui.cpp`) — `webui_set_icon_file()` is inert on Windows, so the Win32 path is ours. Linux hands `brand/png/cell-192.png` to GTK before the first show; macOS is **not** covered — we ship a bare binary, which keeps the generic app icon. The `.rc` id and `kCellIconId` are pinned to the same number by a `static_assert` and by `cell.cellui_boot`, which also fails the build if the resource is not loadable by a *numeric* id |

```bash
# 1. build the front-end (once, or on every UI change)
bun --cwd frontend install
bun --cwd frontend run build

# 2. configure + build (the embed step runs automatically)
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build

# result: one self-contained executable
build/bin/cellui          # cellui.exe on Windows
```

`cellui` accepts `--size WxH`, `--port N`, `--host ADDR`, `--no-serve` (open the
window without the agent, e.g. to iterate on the UI alone). If the front-end has
not been built, the binary still runs and shows a built-in placeholder page.

### The native bridge (JS ↔ C++)

| JS call (`window.cell.*`) | Native behaviour |
| --- | --- |
| `cell_bootstrap()` | version, loopback API base URL + bearer token, platform |
| `cell_export_session(id, path?)` | renders one session through cell.cpp's own HTML exporter (Teamwork panes included) |
| `cell_export_batch([ids])` | batch export — one file per session |
| `cell_export_all()` | every session on disk |
| `cell_reveal(path)` | show an exported file in the file manager |
| `cell_open_external(url)` | open a URL in the default browser |
| `cell_native_capabilities()` | what the native layer provides today |
| `cell_notify(text)` | placeholder for native notifications (the web UI shows its own toast) |

These are the **internal interface bridge** the GUI builds on: exports never
leave the process, and the placeholders (`cell_native_capabilities`,
`cell_notify`) reserve the seam for a future native shell (menus, tray,
notifications) without changing the web layer.

### Front-end workflow

```bash
bun --cwd frontend run dev        # dev server on :5173 (browser mode, no bridge)
bun --cwd frontend run lint       # oxlint --type-aware
bun --cwd frontend run fmt        # oxfmt
```

Vue 3.6's **vapor mode** is enabled automatically by `vite.config.ts` once the
installed `vue` is ≥ 3.6 (the published 3.5.x compiler has no vapor flag); the
build log states which mode is active. See `frontend/README.md` for the layout,
the store/API split and the human-touch feature list (command palette,
onboarding, approval cards, toasts, shortcuts).

---

## 8. Verified toolchain matrix

The build was exercised end-to-end on the toolchains below while this
documentation was written; CI runs the same three steps (configure → build →
ctest) on every platform.

| Scenario | Toolchain / command | Result |
| --- | --- | --- |
| Default build (CLI + DLL) | MSYS2 UCRT64 **GCC 16.2** + Ninja, Release | ✅ `cell.exe`, `cell.dll`, `ctest` 2/2 (self-test + embedding smoke test) |
| Static library + install | same, `-DCELL_BUILD_STATIC=ON` + `cmake --install` | ✅ `libcell.a`, `cell.dll` + `cell.h` + `cell-config.cmake` installed |
| `find_package(cell)` consumer | separate CMake project using the installed prefix | ✅ `cell::shared` and `cell::static` both compile, link and run |
| Clang build | MSYS2 UCRT64 **Clang 22** (auto-added `-fsized-deallocation`) | ✅ builds, `ctest` 2/2 |
| Debug build | same GCC, `-DCMAKE_BUILD_TYPE=Debug` | ✅ builds (dynamic libstdc++, see §11) |
| Desktop preset | `cmake --preset desktop-dll` (DLL + smoke test only) | ✅ DLL produced in 23 s, smoke test passes |
| End-to-end agent run | local mock OpenAI-compatible SSE server | ✅ CLI one-shot replies; a **pure-C program** linking `cell.dll` gets the same reply through `cell_run_oneshot()` with `rc=0` |
| Service layer E2E | `tests/serve_e2e/run.sh` (mock provider + `cell --serve`) | ✅ all checks: auth, sessions, JSON + SSE turns, config, providers, notices, usages, skills, approvals (allow *and* deny), interrupt/resume, graceful shutdown |
| Desktop shell (`cellui`) | GCC 16.2, `-DCELL_BUILD_WEBUI=ON`, front-end embedded | ✅ single binary links; WebView2 window opens (probe); **no `WebView2Loader.dll` dependency** (static loader); `objdump` shows only system DLLs |
| Vendored WebUI from source | `webui/third_party/webui` (webui.c + civetweb + win32_wv2.cpp) | ✅ compiles with MinGW + MSVC defines; static loader links with both |
| DLL export table | `objdump -p cell.dll` | ✅ exactly 5 exports: `cell_main`, `cell_version`, `cell_selftest`, `cell_run_oneshot`, `cell_free` |
| AddressSanitizer | not available in MSYS2 UCRT64 (no sanitizer runtime shipped) | ⚠️ configure refuses with guidance; ASan is covered by the Linux CI job |

MSVC / Linux-GCC / macOS-AppleClang are covered by `.github/workflows/ci.yml`.

---

## 9. Tests

```bash
ctest --test-dir build --output-on-failure
```

| Test | What it checks |
| --- | --- |
| `cell.selftest` | the binary's built-in suite (sandbox, sanitizer, editor, crypto, config, sessions, skills, stats, tool registry, serve transport helpers) — runs in a scratch cwd |
| `cell.embed_smoke` | links the **shared library** through `include/cell.h`: exports resolve, `cell_version()` answers, `cell_main("--help")` returns 0, bad argument lists return an error code instead of exiting |

Optional end-to-end harness for the **service layer** (not wired into ctest: it
needs Python and starts a mock provider on loopback):

```bash
CELL_BIN=build/default/bin/cell PYTHON=python3 bash tests/serve_e2e/run.sh
```

It drives a real `cell --serve` process over HTTP/SSE: auth, sessions,
JSON + SSE turns, config patches, providers, notices, usages, skills, the
approval round-trip (allow *and* deny), interrupt/resume and graceful shutdown.

Run the self-test directly any time:

```bash
build/bin/cell --selftest
```

---

## 10. CI

`.github/workflows/ci.yml` runs five jobs — Linux GCC 14 (warnings-as-errors),
Linux ASan+UBSan, Windows MSVC via the preinstalled vcpkg, Windows MSYS2 UCRT64
GCC, and macOS AppleClang. Each installs its dependencies, configures, builds
and runs ctest. The build is non-interactive and hermetic: no step needs a
provider, network access, or a TTY (the smoke test deliberately avoids all
three).

Local reproduction of the CI job:

```bash
cmake --preset ci && cmake --build --preset ci && ctest --preset ci
```

---

## 11. Troubleshooting

**`<generator> file not found` / `std::generator` errors**
Your standard library is too old. See the table in §1; on Windows the easiest
fix is MSYS2 UCRT64 GCC 15+ or VS 2022 17.12+.
With **Clang + libstdc++** the usual cause is different: libstdc++ gates
`std::generator` on `__cpp_sized_deallocation`, which Clang only defines when
asked. Add `-fsized-deallocation` (the CMake build does this automatically;
raw single-file compiler invocations must add it themselves).

**MinGW Debug build: `collect2.exe: error: ld returned 1 exit status` with no further diagnostics**
Known MinGW behaviour when a very large debug object (tens of MB) is linked
against the *static* libstdc++ archive. The CMake build avoids it by only
passing `-static-libgcc -static-libstdc++` for optimized configurations —
Debug builds use the dynamic runtime (or build `Release`).

**MSVC: `error C2589: '(': illegal token on right side of '::'` on every `std::min`/`std::max`**
The Windows SDK's `min`/`max` macros. `cell.cpp` defines `NOMINMAX` before
`windows.h` *and* `#undef`s both macros after the SDK includes, because some
third-party headers re-introduce them. If you add a new SDK/third-party include
to the top block, keep it above that guard.

**MSVC: `error C2039: 'deque': is not a member of 'std'` (or similar)**
libstdc++ pulls several standard headers in transitively; MSVC's STL does not.
Include what you use — the CI MSVC job is the check.

**`The toolchain cannot compile the C++26 standard library features`**
That is the configure-time probe doing its job — read the message it prints,
it lists the minimum toolchains. Override with `-DCELL_TOOLCHAIN_CHECKS=OFF`
only if you know your toolchain is fine.

**`libcurl was not found` / `libsodium was not found`**
Install per the table in §1, or use the vcpkg manifest. If the libraries live in
non-standard locations, pass `-DCURL_ROOT=<prefix>` / `-DCMAKE_PREFIX_PATH=<prefix>`.

**`CELL_ENABLE_ASAN=ON, but this toolchain cannot link the sanitizer runtime`**
Exactly what it says: the distribution does not ship libasan/libubsan (some
MinGW builds, notably MSYS2 UCRT64). Use a GCC/Clang toolchain on Linux/macOS,
MSVC's `/fsanitize=address`, or drop the option.

**Windows: `cell.dll not found` when running your app**
Ship `cell.dll` next to the executable, or add its directory to `PATH`. The
tests avoid this by keeping the DLL in `build/bin` next to the executables.

**MSVC: `unknown argument '--...'` at configure time**
CMake ≥ 3.30 maps C++26 to `/std:c++latest` automatically; on older CMake the
build injects the flag itself. If you pass your own flags, do not *also* set
`CMAKE_CXX_STANDARD` to a lower value.

**Link errors mentioning `sodium_*` / `curl_*` with the static library**
`cell::static` propagates its dependencies (`Threads`, `CURL`, sodium) — make
sure the consumer project can resolve them (CMake package consumers get this
automatically).

**Long build times**
One translation unit is ~1.1 MB / ~22k lines. Install `ccache` (or `sccache`)
and the build picks it up automatically; keep `CELL_ENABLE_LTO=OFF` (default).

---

## 12. Build-time macros

Only the CMake build defines these; the raw single-file build defines none of
them and keeps working unchanged.

| Macro | Where set | Meaning |
| --- | --- | --- |
| `CELL_BUILD_SHARED` | shared target | export the `cell_*` symbols (`dllexport` / default visibility) |
| `CELL_USE_SHARED` | consumers of `cell::shared` | import the symbols (`dllimport` on Windows) — see `cell.h` |
| `CELL_NO_MAIN` | shared/static targets | suppress `main()` so a host executable keeps its own entry point |
| `CELL_VERSION` | all targets | version string returned by `cell_version()` |
