# Vendored upstream: webui-dev/webui

Pinned commit: `f1b28eeeecfc2d63bdb4d4857c6f137468c6d6f6` (2.5.0-beta.4,
verified byte-identical: webui.c, civetweb/, webview/, include/webui.h).

## Merging a newer upstream

    curl -sSL https://codeload.github.com/webui-dev/webui/tar.gz/<sha> -o /tmp/webui.tgz
    tar -xzf /tmp/webui.tgz -C /tmp
    diff -r /tmp/webui-<sha>/src  src/          # review before copying
    cp -r /tmp/webui-<sha>/{src,include,bridge} .

Local additions that upstream does not have (keep them on merge):

* `src/webview/wv2_msvc_compat.cpp` — the five MSVC CRT symbols the static
  WebView2 loader needs under MinGW/LLD (bfd cannot read the MSVC COFF
  members at all).
* `src/webui.c` `_webui_wv_show()` — the WebView2 startup wait is 5000ms, not
  500ms. At 500ms a cold environment creation loses the race, `show_wv()` returns
  false, and the host falls back to the browser; the WebView window then closes
  a few seconds later.
* `src/webui.c` window lifetime — `webui_new_window_id()` zero-initializes the
  window struct (`transparent` was heap garbage), and the server no longer ends
  the cycle when a client that HAD connected drops (`stop = true` removed). The
  window belongs to the host: a page refresh / suspended renderer must not close
  it. `WEBUI_RELOAD_TIMEOUT` is 15000ms as the reconnect poll interval.
* `src/webview/win32_wv2.cpp` — `put_IsVisible(TRUE)` after `put_Bounds`; the
  controller can load the page (it sets the title) while the surface stays blank.
* This file.

Note: the packaged `lib/WebView2LoaderStatic.lib` comes from the upstream
release, not the source tree.
