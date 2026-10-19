#!/usr/bin/env python3
"""Real-machine window geometry test for cellui (Windows + interactive desktop).

Proves the DSHL-style behaviour end to end:
  1. launch cellui, move/resize the native WebView2 window to a known rect
  2. the 500ms supervisor persists it to <CELL_ROOT>/window.json
  3. close, relaunch: the window comes back at the same rect
  4. capture a screenshot of both runs for visual evidence

Opt-in (a desktop session is required; headless CI skips):
    CELLUI_GEOMETRY_TEST=1 CELLUI_BIN=... python3 tests/cellui_geometry.py

Screenshots land in build/rel-assets/window-geometry/.
"""
import ctypes
import ctypes.wintypes as wt
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

BIN = Path(os.environ.get("CELLUI_BIN", ""))

if sys.platform != "win32" or os.environ.get("CELLUI_GEOMETRY_TEST") != "1":
    print("skipped: Windows + CELLUI_GEOMETRY_TEST=1 required")
    sys.exit(0)

u32 = ctypes.WinDLL("user32", use_last_error=True)

# Match cellui's per-monitor-v2 awareness BEFORE any window is created. A
# DPI-unaware test process sees DWM-virtualised logical coordinates, while
# cellui's GetWindowPlacement/window.json are physical: on a 175% display every
# comparison would be off by 1.75x.
try:
    u32.SetProcessDpiAwarenessContext.argtypes = [ctypes.c_void_p]
    u32.SetProcessDpiAwarenessContext.restype = wt.BOOL
    u32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))  # PER_MONITOR_AWARE_V2
except Exception:
    try:
        u32.SetProcessDPIAware()
    except Exception:
        pass

u32.SetWindowPos.argtypes = [wt.HWND, wt.HWND, ctypes.c_int, ctypes.c_int,
                             ctypes.c_int, ctypes.c_int, ctypes.c_uint]
u32.SetWindowPos.restype = wt.BOOL
u32.GetWindowRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]
u32.GetWindowRect.restype = wt.BOOL
u32.PostMessageW.argtypes = [wt.HWND, ctypes.c_uint, wt.WPARAM, wt.LPARAM]
u32.ShowWindow.argtypes = [wt.HWND, ctypes.c_int]
u32.SetForegroundWindow.argtypes = [wt.HWND]
u32.GetDpiForWindow.argtypes = [wt.HWND]
u32.SystemParametersInfoW.argtypes = [ctypes.c_uint, ctypes.c_uint, ctypes.c_void_p, ctypes.c_uint]

SWP_NOZORDER = 0x0004
SWP_NOACTIVATE = 0x0010
WM_CLOSE = 0x0010
SPI_GETWORKAREA = 0x0030


def work_area():
    r = wt.RECT()
    if not u32.SystemParametersInfoW(SPI_GETWORKAREA, 0, ctypes.byref(r), 0):
        return None
    return r.left, r.top, r.right - r.left, r.bottom - r.top


def find_window(pid, title="cell"):
    found = []

    @ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
    def cb(h, _l):
        p = wt.DWORD()
        u32.GetWindowThreadProcessId(h, ctypes.byref(p))
        if p.value != pid:
            return True
        n = u32.GetWindowTextLengthW(h)
        buf = ctypes.create_unicode_buffer(n + 1)
        u32.GetWindowTextW(h, buf, n + 1)
        if u32.IsWindowVisible(h) and buf.value == title:
            found.append(h)
            return False
        return True

    u32.EnumWindows(cb, 0)
    return found[0] if found else None


def rect_of(h):
    r = wt.RECT()
    u32.GetWindowRect(h, ctypes.byref(r))
    return r.left, r.top, r.right - r.left, r.bottom - r.top


def set_rect(h, x, y, w, hgt):
    return bool(u32.SetWindowPos(h, None, x, y, w, hgt, SWP_NOZORDER | SWP_NOACTIVATE))


def launch(root):
    env = dict(os.environ)
    env["CELL_ROOT"] = root
    # the in-process kernel boots too: without it the SPA has no api.base and
    # paints a blank page, which makes the screenshots useless as evidence
    return subprocess.Popen([str(BIN)], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def wait_window(proc, timeout=45):
    end = time.time() + timeout
    while time.time() < end:
        if proc.poll() is not None:
            return None
        h = find_window(proc.pid)
        if h:
            return h
        time.sleep(0.25)
    return None


def close_window(h, proc):
    u32.PostMessageW(h, WM_CLOSE, 0, 0)
    try:
        proc.wait(timeout=20)
    except subprocess.TimeoutExpired:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


# CopyFromScreen in a DPI-unaware PowerShell captures the virtualised (logical)
# screen; the test is per-monitor-v2 aware, so it divides by the window's DPI
# before passing the rect. WebView2 content is a composition surface that
# PrintWindow returns blank for, so the window is raised with HWND_TOPMOST
# (SetForegroundWindow is blocked for a background launcher) and the screen is
# captured.
# CopyFromScreen in a DPI-unaware PowerShell captures the virtualised (logical)
# screen; the test is per-monitor-v2 aware, so it divides by the window's DPI.
PS_SHOT = r'''param([int]$x, [int]$y, [int]$w, [int]$h, [string]$path)
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($x, $y, 0, 0, $bmp.Size)
$bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
'''

k32 = ctypes.WinDLL("kernel32", use_last_error=True)
u32.GetWindowThreadProcessId.argtypes = [wt.HWND, ctypes.POINTER(wt.DWORD)]
u32.GetWindowThreadProcessId.restype = wt.DWORD
k32.GetCurrentThreadId.restype = wt.DWORD
u32.AttachThreadInput.argtypes = [wt.DWORD, wt.DWORD, wt.BOOL]
u32.BringWindowToTop.argtypes = [wt.HWND]


def bring_to_front(hwnd):
    """SetForegroundWindow is blocked for a background launcher; attaching to
    the foreground thread lifts that restriction (the standard workaround).
    HWND_TOPMOST is deliberately NOT used: it invalidated the WebView2 window
    here (GetWindowRect returned 0 right after, and the supervisor lost it)."""
    fg = u32.GetForegroundWindow()
    fg_tid = u32.GetWindowThreadProcessId(fg, None) if fg else 0
    cur_tid = k32.GetCurrentThreadId()
    if fg_tid and fg_tid != cur_tid:
        u32.AttachThreadInput(cur_tid, fg_tid, True)
    u32.SetForegroundWindow(hwnd)
    u32.BringWindowToTop(hwnd)
    if fg_tid and fg_tid != cur_tid:
        u32.AttachThreadInput(cur_tid, fg_tid, False)


def screenshot(hwnd, rect, path):
    """Foreground the window (thread-input attach), then capture its rect."""
    bring_to_front(hwnd)
    time.sleep(0.7)
    x, y, w, h = rect_of(hwnd)  # re-read: the window may have been repositioned
    if w <= 0 or h <= 0:
        print("  screenshot: window disappeared before capture")
        return False
    try:
        u32.GetDpiForWindow.restype = ctypes.c_uint
        dpi = u32.GetDpiForWindow(hwnd) or 96
    except Exception:
        dpi = 96
    s = dpi / 96.0
    lx, ly, lw, lh = round(x / s), round(y / s), round(w / s), round(h / s)
    script = Path(tempfile.gettempdir()) / "cellui_geometry_shot.ps1"
    script.write_text(PS_SHOT, encoding="ascii")
    r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
                        "-File", str(script), str(lx), str(ly), str(lw), str(lh), str(path)],
                       capture_output=True)
    ok = r.returncode == 0 and Path(path).exists() and Path(path).stat().st_size > 0
    if not ok:
        # PowerShell on a zh-CN Windows emits GBK; never let the diagnostic
        # decode kill the test
        print("screenshot rc:", r.returncode, "rect:", (lx, ly, lw, lh), "path:", path)
        print("screenshot stdout:", (r.stdout or b"").decode("utf-8", "replace")[-600:])
        print("screenshot stderr:", (r.stderr or b"").decode("utf-8", "replace")[-600:])
    return ok


def main():
    if not BIN.exists():
        print(f"CELLUI_BIN not found: {BIN}")
        return 2
    area = work_area()
    if area is None:
        print("no work area")
        return 2
    ax, ay, aw, ah = area
    # the shell enforces a 640x480 logical minimum, which is scaled by the DPI;
    # pick a target above it and still inside the work area
    try:
        u32.GetDpiForSystem.restype = ctypes.c_uint
        dpi = u32.GetDpiForSystem() or 96
    except Exception:
        dpi = 96
    scale = dpi / 96.0
    min_w, min_h = round(640 * scale), round(480 * scale)
    tw = min(aw - 120, max(1000, min_w + 40))
    th = min(ah - 120, max(700, min_h + 40))
    tx, ty = ax + 60, ay + 50
    if tw < min_w or th < min_h:
        print(f"work area too small: {area} (min {min_w}x{min_h})")
        return 2
    print(f"dpi={dpi} scale={scale:.2f} min={min_w}x{min_h}")
    target = (tx, ty, tw, th)
    print(f"target rect: {target} (work area {area})")

    out = Path("build/rel-assets/window-geometry").resolve()
    out.mkdir(parents=True, exist_ok=True)
    root = tempfile.mkdtemp(prefix="cellui-geom-")
    state = Path(root) / "window.json"
    fails = []

    # ---- run 1: move/resize, wait for the supervisor to persist -------------
    p1 = launch(root)
    h1 = wait_window(p1)
    if h1 is None:
        print("run 1: no native window (WebView2 unavailable?)")
        p1.terminate()
        return 2
    started = rect_of(h1)
    print(f"run 1 started at {started}")
    if not set_rect(h1, *target):
        fails.append("SetWindowPos failed")
    # 1.8s: two supervisor polls (500ms each) plus margin. Do NOT wait longer:
    # this WebUI build's bridge closes the window ~5s after connect when its
    # socket drops (webui.ts release-close path), which is unrelated to geometry.
    # The screenshot therefore shows the titlebar/position, not a painted SPA in
    # this WebView2 state; the geometry assertions are the authoritative check.
    time.sleep(1.8)
    actual = rect_of(h1)
    print(f"run 1 after move: {actual}")
    if tuple(actual) != target:
        fails.append(f"move did not stick: {actual} != {target}")
    shot1 = out / "run1.png"
    if not screenshot(h1, actual, shot1):
        fails.append("run1 screenshot failed")
    ok_state = state.exists()
    saved = json.loads(state.read_text()) if ok_state else None
    print(f"window.json: {saved}")
    if not ok_state:
        fails.append("window.json was not written")
    else:
        for k, v in zip(("x", "y", "width", "height"), target):
            if abs(int(saved.get(k, -99999)) - v) > 2:
                fails.append(f"window.json {k}={saved.get(k)} != {v}")
        if saved.get("maximized") is not False:
            fails.append("window.json maximized should be false")
    close_window(h1, p1)

    # ---- run 2: the same root must restore the rect -------------------------
    p2 = launch(root)
    h2 = wait_window(p2)
    if h2 is None:
        print("run 2: no native window")
        p2.terminate()
        return 2
    time.sleep(1.8)  # show + the supervisor's one-time re-apply
    restored = rect_of(h2)
    print(f"run 2 restored at {restored} (expected {target})")
    if any(abs(a - b) > 2 for a, b in zip(restored, target)):
        fails.append(f"restore mismatch: {restored} != {target}")
    shot2 = out / "run2.png"
    if not screenshot(h2, restored, shot2):
        fails.append("run2 screenshot failed")
    close_window(h2, p2)

    for p in (shot1, shot2):
        if p.exists() and p.stat().st_size < 5000:
            fails.append(f"{p.name} looks empty ({p.stat().st_size} bytes)")
        print(f"screenshot: {p} ({p.stat().st_size if p.exists() else 0} bytes)")

    print("\n" + ("OK: geometry persisted and restored" if not fails else "FAILED: " + "; ".join(fails)))
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
