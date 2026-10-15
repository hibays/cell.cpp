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

  3. (hard gate on Windows, static) The binary carries its brand icon as a
     *numerically* addressed RT_GROUP_ICON. That is what the shell's WM_SETICON
     path loads with MAKEINTRESOURCE (webui/cellui.cpp, kCellIconId): an
     undefined identifier in the .rc is stored as a string name instead, which
     MAKEINTRESOURCE cannot reach, and the window quietly keeps the default icon
     — the same "silently wrong window" class as check 1.

Run directly or via ctest (cell.cellui_boot):
    CELLUI_BIN=/path/to/cellui python3 tests/cellui_smoke.py
"""
import json
import os
import socket
import struct
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


def _pe_resource_leaves(data: bytes):
    """(type, name) pairs of every leaf in a PE resource directory, with each
    name either an int (numeric id) or a str (named resource). Offsets inside
    the tree are relative to the .rsrc directory base."""
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe:pe + 4] != b"PE\0\0":
        return None
    nsec = struct.unpack_from("<H", data, pe + 6)[0]
    opt_size = struct.unpack_from("<H", data, pe + 20)[0]
    magic = struct.unpack_from("<H", data, pe + 24)[0]
    dir_off = pe + 24 + (112 if magic == 0x20B else 96)
    rsrc_rva = struct.unpack_from("<I", data, dir_off + 2 * 8)[0]  # directory entry 2
    sections = []
    for i in range(nsec):
        s = pe + 24 + opt_size + i * 40
        vsize, va, _, raw = struct.unpack_from("<IIII", data, s + 8)
        sections.append((va, vsize, raw))
    base = None
    for va, vsize, raw in sections:
        if va <= rsrc_rva < va + max(vsize, 1):
            base = raw + (rsrc_rva - va)
    if base is None:
        return None

    leaves = []

    def walk(off, path):
        named, ids = struct.unpack_from("<HH", data, base + off + 12)
        for i in range(named + ids):
            name_or_id, child = struct.unpack_from("<II", data, base + off + 16 + i * 8)
            if name_or_id & 0x80000000:
                no = base + (name_or_id & 0x7FFFFFFF)
                slen = struct.unpack_from("<H", data, no)[0]
                ident = data[no + 2: no + 2 + slen * 2].decode("utf-16-le", "replace")
            else:
                ident = name_or_id
            if child & 0x80000000:
                walk(child & 0x7FFFFFFF, path + [ident])
            else:
                # the tree is type -> name -> language: the leaf's own ident is
                # the language (1033 here), and path is [type, name]
                leaves.append((path[0], path[1]) if len(path) >= 2 else (None, ident))

    walk(0, [])
    return leaves


def check_window_icon_resource() -> bool:
    """The shell's window icon must be loadable by id (see the module docstring)."""
    if not BIN.is_file():
        print(f"skip: CELLUI_BIN not set or missing ({BIN})")
        return True  # soft skip; the ctest gate guarantees the path exists
    data = BIN.read_bytes()
    if data[:2] != b"MZ":
        print("skip: not a Windows PE (this platform has no .ico window icon)")
        return True
    leaves = _pe_resource_leaves(data)
    if leaves is None:
        print("FAIL: no PE resource directory — the icon cannot be embedded")
        return False
    RT_GROUP_ICON = 14
    groups = [name for typ, name in leaves if typ == RT_GROUP_ICON]
    if not groups:
        print("FAIL: no RT_GROUP_ICON in the binary — the window would keep the default icon")
        return False
    numeric = [g for g in groups if isinstance(g, int)]
    if not numeric:
        print(f"FAIL: RT_GROUP_ICON is addressed by name {groups!r}; MAKEINTRESOURCE needs a numeric id")
        return False
    print(f"window icon: RT_GROUP_ICON id={numeric[0]} (MAKEINTRESOURCE-loadable) OK")
    return True


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
    ok = check_window_icon_resource() and ok
    ok = check_kernel_boots() and ok
    if ok:
        print("cellui_smoke OK")
        return 0
    print("cellui_smoke FAILED")
    return 1


if __name__ == "__main__":
    sys.exit(main())
