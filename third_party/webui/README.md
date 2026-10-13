# third_party/webui

Vendored copy of [WebUI](https://github.com/webui-dev/webui) — the driver behind
the `cellui` desktop shell. Compiled from source by the CMake build (see
`CMakeLists.txt`, target `webui`).

| | |
| --- | --- |
| Upstream | https://github.com/webui-dev/webui |
| Version | **2.5.0-beta.3** (release `2.5.0-beta.3`, source from `f1b28ee`) |
| License | MIT — see `LICENSE` in this directory |
| Contents | `include/webui.h`, `src/webui.c`, `src/civetweb/`, `src/webview/`, `bridge/` |

## What is compiled

* `src/webui.c` + `src/civetweb/civetweb.c` — the core + its embedded HTTP server
  (`NO_CACHING NO_CGI USE_WEBSOCKET NO_SSL` are the upstream defaults used here).
* `src/webview/win32_wv2.cpp` (Windows) — the WebView2 backend.
* `src/webview/wkwebview.m` (macOS) — the WKWebView backend.

## WebView2 loader (Windows)

`lib/WebView2LoaderStatic.lib` (x64) comes from the official WebView2 SDK
([NuGet `Microsoft.Web.WebView2` 1.0.3179.45](https://www.nuget.org/packages/Microsoft.Web.WebView2)),
which is distributed under the Microsoft Software License Terms for the WebView2
SDK. Linking it **statically** means the shipped `cellui.exe` needs no
`WebView2Loader.dll` next to it; the WebView2 *runtime* itself is part of
Windows (Evergreen) and provides the actual rendering engine.

`src/webview/win32_wv2.cpp` picks the static loader when it is linked and falls
back to `LoadLibrary("WebView2Loader.dll")` otherwise, so building without the
`.lib` still works — the binary then requires the loader DLL at runtime.

## Updating

1. fetch the newer release zip (`webui-windows-msvc-x64.zip` /
   `webui-windows-gcc-x64.zip`) or the source tarball from the release page;
2. replace `include/`, `src/`, `bridge/` (keep this README);
3. re-run `cmake` + build — `cellui` links the sources directly, nothing else to
   regenerate.
