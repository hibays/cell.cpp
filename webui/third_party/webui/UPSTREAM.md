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
* This file.

Note: the packaged `lib/WebView2LoaderStatic.lib` comes from the upstream
release, not the source tree.
