#!/usr/bin/env python3
"""End-to-end test: kernel serve + a mock LLM provider, no network.

Proves the workflow the front-end drives:
  serve -> health -> session -> turn (streamed from the mock) -> transcript

Isolation: CELL_ROOT points at a temp dir, so nothing touches the user's
sessions/vault/server.json. Run directly or via ctest (cell.e2e_serve).

    CELL_BIN=/path/to/cell python3 tests/e2e_serve.py
"""
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BIN = Path(os.environ.get("CELL_BIN", ""))


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class MockLLM(BaseHTTPRequestHandler):
    """Minimal OpenAI-compatible /v1/chat/completions (non-stream JSON)."""

    def log_message(self, *a):  # silence
        pass

    def do_GET(self):
        # the kernel probes GET {base}/models at startup / before a turn
        payload = json.dumps({"data": [{"id": "mock-model"}], "object": "list"}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n) or b"{}")
        last = ""
        for m in body.get("messages", []):
            if m.get("role") == "user":
                last = m.get("content", "")
        text = f"mock reply to: {last[:80]}"
        # the kernel always requests stream=true — answer in OpenAI SSE chunks
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        # close-delimited body: without this the macOS curl build treats the
        # missing length as a broken response ("connection closed")
        self.send_header("Connection", "close")
        self.end_headers()
        first = json.dumps(
            {"choices": [{"delta": {"role": "assistant", "content": text}}]}
        )
        self.wfile.write(f"data: {first}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n")


def api(base: str, token: str, method: str, path: str, body: dict | None = None):
    req = urllib.request.Request(
        base + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"{}")


def wait_healthy(base: str, token: str, proc: subprocess.Popen, timeout: float = 30.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"cell --serve exited early rc={proc.returncode}")
        try:
            req = urllib.request.Request(base + "/v1/health")
            with urllib.request.urlopen(req, timeout=2) as r:
                return json.loads(r.read())
        except Exception:
            time.sleep(0.2)
    raise RuntimeError("serve never became healthy")


def run_once(attempt: int) -> bool:
    """One full attempt on a fresh kernel, mock LLM and CELL_ROOT. Connection
    setup races on loaded CI runners are per-process, so a second attempt with
    everything new is the honest retry."""
    root = Path(tempfile.mkdtemp(prefix="cell-e2e-"))
    llm_port = free_port()
    llm = ThreadingHTTPServer(("127.0.0.1", llm_port), MockLLM)
    threading.Thread(target=llm.serve_forever, daemon=True).start()

    # the vault is the real key store; the env var is the documented fallback
    env = dict(os.environ, CELL_ROOT=str(root), OPENAI_API_KEY="sk-test")
    cfg_dir = root / "config"
    cfg_dir.mkdir(parents=True, exist_ok=True)
    (root / "config.json").write_text(
        json.dumps(
            {
                "providers": [
                    {
                        "name": "mock",
                        "style": "openai",
                        "base": f"http://127.0.0.1:{llm_port}/v1",
                        "key": "sk-test",
                    }
                ],
                "current_provider": "mock",
                "current_model": "mock-model",
                "tools": False,
            }
        )
    )

    port = free_port()
    env["CELL_SERVE_PORT"] = str(port)  # not used by the kernel; --port is explicit
    err_file = open(root / "kernel-stderr.log", "wb")
    argv = [str(BIN), "--serve", "--port", str(port), "--host", "127.0.0.1"]
    if sys.platform == "darwin" and os.environ.get("CELL_LLDB") == "1":
        # the known macOS SIGABRT (unreachable-provider turn): wrap the kernel
        # in lldb batch so the abort leaves a full backtrace in the log
        argv = ["lldb", "--batch", "-o", "run",
                "-k", "thread backtrace all", "-k", "detach", "-k", "quit",
                "--", str(BIN), "--serve", "--port", str(port), "--host", "127.0.0.1"]
        print("  running under lldb (CELL_LLDB=1)")
    proc = subprocess.Popen(
        argv,
        env=env,
        cwd=str(root),
        stdout=err_file,  # lldb prints the -k backtraces on stdout
        stderr=err_file,
    )
    try:
        print(f"attempt {attempt}: CELL_ROOT={root}")
        base = f"http://127.0.0.1:{port}"
        health = wait_healthy(base, "", proc)
        assert health["status"] == "ok", health
        print("health:", health["version"], health["provider"], health["model"])

        token = ""
        for _ in range(50):
            sj = root / "server.json"
            if sj.exists():
                token = json.loads(sj.read_text())["token"]
                break
            time.sleep(0.1)
        assert token, "server.json never appeared"

        # the discovery file must live under CELL_ROOT, not next to the binary
        assert (root / "server.json").exists(), "CELL_ROOT isolation broken"

        created = api(base, token, "POST", "/v1/sessions")
        sid = created["id"]
        print("session:", sid)

        turn = api(base, token, "POST", f"/v1/sessions/{sid}/turn", {"text": "hello cell"})
        out = turn.get("output", "")
        assert "mock reply" in out, f"turn output missing mock reply: {turn}"
        print("turn output:", out[:60])

        msgs = api(base, token, "GET", f"/v1/sessions/{sid}/messages")
        roles = [m["role"] for m in msgs.get("messages", msgs.get("entries", []))]
        assert "assistant" in roles, roles
        print("transcript roles:", roles)

        api(base, token, "POST", "/v1/shutdown")
        proc.wait(timeout=15)
        return True
    except Exception as e:
        print(f"  failed while alive={proc.poll() is None} rc={proc.poll()}")
        try:
            err_file.flush()
            tail = (root / "kernel-stderr.log").read_text(errors="replace")[-1500:]
            print("  --- kernel stderr tail ---\n" + tail)
        except Exception as e2:
            print(f"  (no kernel stderr: {e2})")
        if proc.poll() is None:
            proc.kill()
        raise
    finally:
        llm.shutdown()
        err_file.close()


def main() -> int:
    if not BIN.is_file():
        print(f"skip: CELL_BIN not set or missing ({BIN})")
        return 0
    for attempt in (1, 2, 3):
        try:
            if run_once(attempt):
                print("e2e_serve OK")
                return 0
            print(f"attempt {attempt} failed")
        except Exception as e:
            print(f"attempt {attempt} failed: {e}")
    print("e2e_serve FAILED (all attempts)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
