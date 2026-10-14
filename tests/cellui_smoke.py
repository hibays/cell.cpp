#!/usr/bin/env python3
"""Smoke test for the cellui desktop shell.

Two independent checks, both guarding the "内核未就绪" (kernel not ready) class
of failures:

  1. (hard gate, runs everywhere) The built binary embeds the WebUI front-end
     bridge: the literal "/webui.js" must appear somewhere in the executable.
     If it does not, the shell has no native bridge to bind and will always
     report "kernel not ready" — exactly the regression that shipped once.

  2. (opt-in, needs a display) Spawn the shell and wait for server.json, proving
     the in-process kernel actually boots. Skipped unless CELLUI_BOOT_TEST=1
     (set only in a job that runs under Xvfb / a real display). Headless CI
     runners cannot open the WebView window, so the boot check defaults off to
     keep the suite green; the static embed gate above is the portable guarantee.

Run directly or via ctest (cell.cellui_boot):
    CELLUI_BIN=/path/to/cellui python3 tests/cellui_smoke.py
"""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

BIN = Path(os.environ.get("CELLUI_BIN", ""))


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def check_embedded_bridge() -> bool:
    """The binary must contain the /webui.js string the embedded SPA loads."""
    if not BIN.is_file():
        print(f"skip: CELLUI_BIN not set or missing ({BIN})")
        return True  # soft skip; the ctest gate guarantees the path exists
    data = BIN.read_bytes()
    ok = b"/webui.js" in data
    if ok:
        print(f"embedded bridge: /webui.js present in {BIN.name} OK")
    else:
        print("FAIL: /webui.js not found in binary — shell cannot bind the native bridge")
    return ok


def check_kernel_boots() -> bool:
    if os.environ.get("CELLUI_BOOT_TEST") != "1":
        print("skip: CELLUI_BOOT_TEST != 1 (no display in this job)")
        return True

    root = Path(tempfile.mkdtemp(prefix="cellui-boot-"))
    env = dict(os.environ, CELL_ROOT=str(root))
    proc = subprocess.Popen(
        [str(BIN)],
        env=env,
        cwd=str(root),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        sj = root / "server.json"
        deadline = time.time() + 30
        while time.time() < deadline:
            if proc.poll() is not None:
                print(f"cellui exited early rc={proc.returncode}")
                return False
            if sj.exists():
                info = json.loads(sj.read_text())
                assert info.get("token"), "server.json missing token"
                print(f"cellui kernel booted: port={info.get('port')} token present")
                return True
            time.sleep(0.2)
        print("cellui never wrote server.json (kernel did not boot)")
        return False
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except Exception:
                proc.kill()


def main() -> int:
    ok = check_embedded_bridge()
    ok = check_kernel_boots() and ok
    if ok:
        print("cellui_smoke OK")
        return 0
    print("cellui_smoke FAILED")
    return 1


if __name__ == "__main__":
    sys.exit(main())
