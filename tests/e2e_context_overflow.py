#!/usr/bin/env python3
"""End-to-end: empty / reasoning-only / truncated turns and the 4k context window.

The kernel must never accept a success-shaped stream that delivered nothing:
  * empty completion (context overflow) -> provider diagnostic + auto-compact
  * reasoning-only ("thinking, then silent") -> failed turn, not a silent rc=0
  * content_filter -> a diagnostic that names the filter
  * a single JSON body (server ignoring stream=true) -> content still recovered
  * multi-turn: a failed reasoning-only turn must not poison the next turn

Isolation: CELL_ROOT is a temp dir; the mock is on loopback. Run directly or via
ctest (cell.e2e_context_overflow).

    CELL_BIN=/path/to/cell python3 tests/e2e_context_overflow.py
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
TOKEN = "e2e-overflow-token"

# mock behaviour, switched by POST /__mode
MODE = "normal"
COUNTER = 0


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def sse(chunks):
    body = "".join("data: " + json.dumps(c) + "\n\n" for c in chunks) + "data: [DONE]\n\n"
    return body.encode(), "text/event-stream"


class MockLLM(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        payload = json.dumps({"data": [{"id": "mock-model"}], "object": "list"}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        global MODE, COUNTER
        n = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(n) if n else b"{}"
        if self.path == "/__mode":
            MODE = json.loads(raw.decode()).get("mode", "normal")
            COUNTER = 0
            self._json(200, {"mode": MODE})
            return
        if self.path != "/v1/chat/completions":
            self._json(404, {"error": {"message": "not found"}})
            return

        COUNTER += 1
        mode = MODE
        # overflow_then_normal: the first request is the overflowed turn; every
        # later request (compaction summary + the retried turn) is a normal answer.
        if mode == "overflow_then_normal":
            mode = "empty_overflow" if COUNTER == 1 else "normal"

        if mode == "normal":
            payload, ctype = sse([
                {"choices": [{"index": 0, "delta": {"role": "assistant", "content": "hello from mock"}}]},
                {"choices": [{"index": 0, "delta": {"content": "!"}, "finish_reason": "stop"}],
                 "usage": {"prompt_tokens": 12, "completion_tokens": 3}},
            ])
        elif mode == "reasoning_only":
            # Ollama's field name: delta.reasoning
            payload, ctype = sse([
                {"choices": [{"index": 0, "delta": {"role": "assistant", "reasoning": "thinking 1 "}}]},
                {"choices": [{"index": 0, "delta": {"reasoning": "thinking 2 "}}]},
                {"choices": [{"index": 0, "delta": {"content": ""}, "finish_reason": "stop"}],
                 "usage": {"prompt_tokens": 12, "completion_tokens": 4}},
            ])
        elif mode == "reasoning_content_only":
            # DeepSeek / vLLM field name: delta.reasoning_content
            payload, ctype = sse([
                {"choices": [{"index": 0, "delta": {"role": "assistant", "reasoning_content": "thinking 1 "}}]},
                {"choices": [{"index": 0, "delta": {"content": ""}, "finish_reason": "stop"}],
                 "usage": {"prompt_tokens": 12, "completion_tokens": 4}},
            ])
        elif mode == "content_filter":
            payload, ctype = sse([
                {"choices": [{"index": 0, "delta": {"role": "assistant", "content": ""},
                              "finish_reason": "content_filter"}],
                 "usage": {"prompt_tokens": 100, "completion_tokens": 0}},
            ])
        elif mode == "single_json":
            # a server that ignores stream=true and returns one JSON body
            payload = json.dumps({"choices": [{"message": {"role": "assistant",
                                                           "content": "hello from single json"}}],
                                  "usage": {"prompt_tokens": 12, "completion_tokens": 4}}).encode()
            ctype = "application/json"
        else:  # empty_overflow: HTTP 200 + empty choices + usage (Ollama 4k cutoff)
            payload, ctype = sse([
                {"choices": [{"index": 0, "delta": {"role": "assistant", "content": ""},
                              "finish_reason": "stop"}],
                 "usage": {"prompt_tokens": 3969, "completion_tokens": 0}},
            ])
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _json(self, code, obj):
        payload = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


class Serve:
    def __init__(self, root):
        self.port = free_port()
        self.mock_port = free_port()
        self.mock = ThreadingHTTPServer(("127.0.0.1", self.mock_port), MockLLM)
        threading.Thread(target=self.mock.serve_forever, daemon=True).start()
        cfg = {"providers": [{"name": "mock", "style": "openai",
                              "base": f"http://127.0.0.1:{self.mock_port}/v1",
                              "context_window": 4096}],
               "current_provider": "mock", "current_model": "mock-model"}
        (Path(root) / "config.json").write_text(json.dumps(cfg))
        env = dict(os.environ)
        env.update({"CELL_ROOT": root, "OPENAI_API_KEY": "dummy",
                    "no_proxy": "127.0.0.1,localhost", "NO_PROXY": "127.0.0.1,localhost"})
        self.proc = subprocess.Popen([str(BIN), "--serve", "--port", str(self.port), "--token", TOKEN],
                                     env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def api(self, method, path, data=None, stream=False):
        url = f"http://127.0.0.1:{self.port}/v1{path}"
        h = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
        if stream:
            h["Accept"] = "text/event-stream"
        req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None,
                                     headers=h, method=method)
        return urllib.request.urlopen(req, timeout=120)

    def wait_health(self):
        for _ in range(150):
            try:
                with self.api("GET", "/health") as r:
                    if r.status == 200:
                        return True
            except Exception:
                pass
            time.sleep(0.2)
        return False

    def set_mode(self, mode):
        with urllib.request.urlopen(urllib.request.Request(
                f"http://127.0.0.1:{self.mock_port}/__mode",
                data=json.dumps({"mode": mode}).encode(),
                headers={"Content-Type": "application/json"}, method="POST"), timeout=10) as r:
            r.read()

    def new_session(self):
        with self.api("POST", "/sessions", {"text": ""}) as r:
            return json.loads(r.read().decode())["id"]

    def turn(self, sid, text="hi"):
        out, errors, done = [], [], None
        self.usage = None
        with self.api("POST", f"/sessions/{sid}/turn", {"text": text}, stream=True) as r:
            for raw in r:
                line = raw.decode("utf-8", "replace").strip()
                if line.startswith("data:"):
                    line = line[5:].strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except Exception:
                    continue
                if ev.get("type") == "output":
                    out.append(ev.get("data", {}).get("text", ""))
                elif ev.get("type") == "error":
                    errors.append(ev.get("data", {}))
                elif ev.get("type") == "usage":
                    self.usage = ev.get("data", {})
                elif ev.get("type") == "turn_done":
                    done = ev.get("data")
        return "".join(out), errors, done

    def close(self):
        self.proc.terminate()
        try:
            self.proc.wait(timeout=5)
        except Exception:
            self.proc.kill()
        self.mock.shutdown()


FAILS = []


def check(name, cond, detail=""):
    print(("  PASS " if cond else "  FAIL ") + name + ("" if cond else f"  [{detail}]"))
    if not cond:
        FAILS.append(name)


def main():
    if not BIN.exists():
        print(f"CELL_BIN not found: {BIN}")
        return 2
    with tempfile.TemporaryDirectory(prefix="cell-e2e-ofl-") as root:
        srv = Serve(root)
        try:
            if not srv.wait_health():
                print("serve did not come up")
                return 2

            # ---- single-turn: normal answer ----
            srv.set_mode("normal")
            sid = srv.new_session()
            out, errors, done = srv.turn(sid)
            check("single-turn normal: rc=0", done and done.get("rc") == 0, done)
            check("single-turn normal: answer streamed", "hello from mock" in out, out)
            check("single-turn normal: no error", not errors, errors)
            check("usage frame carries context_window (manual 4096)",
                  bool(srv.usage) and srv.usage.get("context_window") == 4096, srv.usage)
            check("usage frame carries context_tokens + context_pct",
                  bool(srv.usage) and srv.usage.get("context_tokens") is not None
                  and srv.usage.get("context_pct") is not None, srv.usage)

            # ---- single-turn: reasoning-only (Ollama delta.reasoning) ----
            srv.set_mode("reasoning_only")
            sid = srv.new_session()
            out, errors, done = srv.turn(sid)
            check("reasoning-only (delta.reasoning): rc!=0", done and done.get("rc") != 0, done)
            check("reasoning-only (delta.reasoning): diagnostic names the cause",
                  any("reasoning but produced no answer" in (e.get("message") or "") for e in errors), errors)
            check("reasoning-only (delta.reasoning): not a silent success", bool(errors))

            # ---- single-turn: reasoning-only (DeepSeek delta.reasoning_content) ----
            srv.set_mode("reasoning_content_only")
            sid = srv.new_session()
            out, errors, done = srv.turn(sid)
            check("reasoning-only (reasoning_content): rc!=0", done and done.get("rc") != 0, done)
            check("reasoning-only (reasoning_content): diagnostic names the cause",
                  any("reasoning but produced no answer" in (e.get("message") or "") for e in errors), errors)

            # ---- single-turn: content_filter ----
            srv.set_mode("content_filter")
            sid = srv.new_session()
            out, errors, done = srv.turn(sid)
            check("content_filter: rc!=0", done and done.get("rc") != 0, done)
            check("content_filter: diagnostic names the filter",
                  any("filtered" in (e.get("message") or "") for e in errors), errors)

            # ---- single-turn: provider ignores stream=true (one JSON body) ----
            srv.set_mode("single_json")
            sid = srv.new_session()
            out, errors, done = srv.turn(sid)
            check("single JSON body: rc=0", done and done.get("rc") == 0, done)
            check("single JSON body: content recovered", "hello from single json" in out, out)

            # ---- single-turn: empty completion -> auto-compact -> retry succeeds ----
            srv.set_mode("overflow_then_normal")
            sid = srv.new_session()
            out, errors, done = srv.turn(sid)
            check("overflow recovery: rc=0 after auto-compact + retry", done and done.get("rc") == 0, done)
            check("overflow recovery: answer present", "hello from mock" in out, out)

            # ---- multi-turn: normal -> reasoning-only (fails) -> normal (recovers) ----
            srv.set_mode("normal")
            sid = srv.new_session()
            out1, err1, done1 = srv.turn(sid, "turn one")
            check("multi-turn: turn 1 succeeds", done1 and done1.get("rc") == 0, done1)
            srv.set_mode("reasoning_only")
            out2, err2, done2 = srv.turn(sid, "turn two")
            check("multi-turn: turn 2 (reasoning-only) fails", done2 and done2.get("rc") != 0, done2)
            srv.set_mode("normal")
            out3, err3, done3 = srv.turn(sid, "turn three")
            check("multi-turn: turn 3 recovers after a failed turn", done3 and done3.get("rc") == 0, done3)
            check("multi-turn: turn 3 streamed an answer", "hello from mock" in out3, out3)
        finally:
            srv.close()

    print(f"\n{'OK' if not FAILS else 'FAILED: ' + ', '.join(FAILS)}")
    return 0 if not FAILS else 1


if __name__ == "__main__":
    sys.exit(main())
