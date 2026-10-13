"""Minimal OpenAI-compatible mock server for cell.cpp end-to-end tests.

Serves POST /v1/chat/completions with an SSE stream so the agent's streaming
client path is exercised, and a plain JSON response for non-streaming calls.

Behaviour:
  * a user message containing [EXEC] triggers one exec tool_call
    ("echo serve-approval-ok") — used to exercise the HTTP approval flow
  * anything else returns a fixed assistant reply
"""
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

REPLY = "Hello from the mock server!"


def exec_tool_call():
    return [{
        "index": 0,
        "id": "call_exec_1",
        "type": "function",
        "function": {"name": "exec", "arguments": json.dumps({"cmd": "echo serve-approval-ok"})},
    }]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # quiet
        pass

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        try:
            req = json.loads(body or b"{}")
        except Exception:
            req = {}
        stream = bool(req.get("stream"))
        messages = req.get("messages", [])

        last_user = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                c = m.get("content")
                last_user = c if isinstance(c, str) else json.dumps(c)
                break
        wants_exec = "[EXEC]" in last_user
        wants_slow = "[SLOW]" in last_user
        # the agent sends the tool result back as the last message; after that
        # the mock must answer with plain text instead of proposing the tool again
        last_is_tool = bool(messages) and messages[-1].get("role") == "tool"
        already_ran = last_is_tool
        print("REQ stream=%s roles=%s last_user=%r" % (stream, [m.get("role") for m in messages], last_user[:60]), flush=True)

        if stream:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            if wants_slow:
                # one delta every 300 ms for ~9 s: gives the client time to cancel
                self.wfile.write(f"data: {json.dumps({'choices': [{'index': 0, 'delta': {'role': 'assistant', 'content': 'slow '}}]})}\n\n".encode())
                self.wfile.flush()
                for i in range(30):
                    time.sleep(0.3)
                    chunk = {"choices": [{"index": 0, "delta": {"content": f"chunk{i} "}}]}
                    self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
                    self.wfile.flush()
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
                return
            if wants_exec and not already_ran:
                chunks = [{"choices": [{"index": 0, "delta": {"role": "assistant", "tool_calls": exec_tool_call()}}]},
                          {"choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}],
                           "usage": {"prompt_tokens": 9, "completion_tokens": 7, "total_tokens": 16}}]
            else:
                chunks = [
                    {"choices": [{"index": 0, "delta": {"role": "assistant", "content": REPLY}}]},
                    {"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                     "usage": {"prompt_tokens": 7, "completion_tokens": 5, "total_tokens": 12}},
                ]
            for chunk in chunks:
                self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
                self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        else:
            if wants_exec and not already_ran:
                message = {"role": "assistant", "content": None, "tool_calls": exec_tool_call()}
                finish = "tool_calls"
            else:
                message = {"role": "assistant", "content": REPLY}
                finish = "stop"
            payload = {
                "id": "chatcmpl-mock",
                "object": "chat.completion",
                "model": req.get("model", "mock"),
                "choices": [{"index": 0, "message": message, "finish_reason": finish}],
                "usage": {"prompt_tokens": 7, "completion_tokens": 5, "total_tokens": 12},
            }
            data = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    def do_GET(self):
        if self.path.endswith("/models"):
            data = json.dumps({"object": "list", "data": [{"id": "mock-model", "object": "model"}]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            self.send_response(404)
            self.end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"mock-llm listening on 127.0.0.1:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
