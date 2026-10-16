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


def handle_count(pid: int) -> int:
    """How many OS handles a process holds, or 0 when it cannot be read.

    Windows only, and not by accident: POSIX reclaims a detached thread together
    with the thread, while on MinGW/winpthreads std::thread::detach() never
    closes the underlying Win32 thread handle (join() does). A worker thread per
    connection therefore leaks one handle per request there and nothing at all
    elsewhere — which is why the handle gate below is exercised by the
    windows-msys2 CI job and is an honest no-op on Linux.
    """
    if sys.platform != "win32":
        return 0
    import ctypes

    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    h = k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return 0
    n = ctypes.c_ulong(0)
    ok = k32.GetProcessHandleCount(h, ctypes.byref(n))
    k32.CloseHandle(h)
    return n.value if ok else 0


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
        messages = body.get("messages", [])
        last = ""
        for m in messages:
            if m.get("role") == "user":
                c = m.get("content", "")
                last = c if isinstance(c, str) else json.dumps(c)
        last_is_tool = bool(messages) and messages[-1].get("role") == "tool"
        # "[READ]" proposes one read tool call; the second round (the tool result
        # is the last message) must answer with text instead of proposing it again
        wants_read = "[READ]" in last and not last_is_tool
        wants_slow = "[SLOW]" in last
        text = f"mock reply to: {last[:80]}"
        # the kernel always requests stream=true — answer in OpenAI SSE chunks
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        # close-delimited body: without this the macOS curl build treats the
        # missing length as a broken response ("connection closed")
        self.send_header("Connection", "close")
        self.end_headers()
        if wants_slow:
            # one delta every 250 ms: keeps a turn in flight long enough for the
            # test to post a notice and watch it arrive as a stream event
            for i in range(8):
                self.wfile.write(
                    f"data: {json.dumps({'choices': [{'delta': {'content': f'slow{i} '}}]})}\n\n".encode()
                )
                self.wfile.flush()
                time.sleep(0.25)
            self.wfile.write(
                f"data: {json.dumps({'choices': [{'delta': {}, 'finish_reason': 'stop'}], 'usage': {'prompt_tokens': 4, 'completion_tokens': 8, 'total_tokens': 12}})}\n\n".encode()
            )
            self.wfile.write(b"data: [DONE]\n\n")
            return
        if wants_read:
            chunks = [
                {
                    "choices": [
                        {
                            "delta": {
                                "role": "assistant",
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "id": "call_read_1",
                                        "type": "function",
                                        "function": {"name": "read", "arguments": json.dumps({"path": "probe.txt"})},
                                    }
                                ],
                            }
                        }
                    ]
                },
                {
                    "choices": [{"delta": {}, "finish_reason": "tool_calls"}],
                    "usage": {"prompt_tokens": 9, "completion_tokens": 7, "total_tokens": 16},
                },
            ]
        else:
            chunks = [
                {"choices": [{"delta": {"role": "assistant", "content": text}}]},
                {
                    "choices": [{"delta": {}, "finish_reason": "stop"}],
                    # prompt_tokens_details is what the cache counters are read from
                    "usage": {
                        "prompt_tokens": 7,
                        "completion_tokens": 5,
                        "total_tokens": 12,
                        "prompt_tokens_details": {"cached_tokens": 5},
                    },
                },
            ]
        for c in chunks:
            self.wfile.write(f"data: {json.dumps(c)}\n\n".encode())
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


def api_code(base: str, token: str, method: str, path: str, body: dict | None = None):
    """Return the HTTP status code, following redirects, without raising on 4xx/5xx.

    urllib raises HTTPError for error statuses, so a plain api() call cannot
    inspect a 404/409 body; this wrapper collapses that into a code."""
    import urllib.error

    req = urllib.request.Request(
        base + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


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
    # The agent's working directory, deliberately OUTSIDE the runtime root: cell
    # keeps its vault and config under CELL_ROOT, and the sandbox refuses to read
    # anything inside it — which is exactly right, but it means a fixture that
    # puts the workspace under CELL_ROOT would see every tool read blocked.
    work = Path(tempfile.mkdtemp(prefix="cell-e2e-work-"))
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
        cwd=str(work),
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

        # ---- semantic events: what a GUI renders instead of a terminal ----
        # The turn engine emits these next to the captured stdout; without them
        # the shell can only re-parse the transcript after the turn is over.
        kinds = [e.get("type") for e in turn.get("events", [])]
        assert "token" in kinds, f"no token events: {kinds}"
        streamed = "".join(e["data"]["text"] for e in turn["events"] if e.get("type") == "token")
        assert "mock reply" in streamed, f"token events do not carry the answer: {streamed[:120]}"
        assert "usage" in kinds, f"no usage event: {kinds}"
        usage = next(e["data"] for e in turn["events"] if e.get("type") == "usage")
        assert usage["out_tokens"] == 5 and usage["cached_tokens"] == 5, usage
        assert usage["prompt_tokens"] == 7, usage
        assert isinstance(usage["decode_ms"], int) and usage["decode_ms"] >= 0, usage
        print(f"semantic events: {sorted(set(kinds))} · tok={usage['out_tokens']} cached={usage['cached_tokens']}")

        msgs = api(base, token, "GET", f"/v1/sessions/{sid}/messages")
        roles = [m["role"] for m in msgs.get("messages", msgs.get("entries", []))]
        assert "assistant" in roles, roles
        print("transcript roles:", roles)

        # ---- teamwork + compact endpoints (kernel-side, added later) ----
        tw = api(base, token, "GET", f"/v1/sessions/{sid}/teamworks")
        assert "jobs" in tw and isinstance(tw["jobs"], list), tw
        print("teamworks (session):", len(tw["jobs"]), "job(s)")
        tw_all = api(base, token, "GET", "/v1/teamworks")
        assert "jobs" in tw_all and isinstance(tw_all["jobs"], list), tw_all
        print("teamworks (all):", len(tw_all["jobs"]), "job(s)")
        assert api_code(base, token, "GET", f"/v1/sessions/nope-{sid}/teamworks") == 404

        # ---- teamwork control endpoints (create / stop / run-validate / append / delete) ----
        created_job = api(base, token, "POST", f"/v1/sessions/{sid}/teamworks",
                          {"work-type": "serial", "list": []})
        assert created_job.get("ok") is True and created_job.get("id"), created_job
        jid = created_job["id"]
        print("teamwork created:", jid)
        tw_after = api(base, token, "GET", f"/v1/sessions/{sid}/teamworks")
        assert any(j["id"] == jid for j in tw_after["jobs"]), tw_after
        assert api_code(base, token, "POST", f"/v1/sessions/nope-{sid}/teamworks",
                        {"work-type": "serial", "list": []}) == 404

        # stop is cooperative and harmless on a not-running job -> ok
        stopped = api(base, token, "POST", f"/v1/sessions/{sid}/teamworks/{jid}/stop")
        assert stopped.get("ok") is True, stopped
        # ... but an unknown job is a 404, not a silent "ok" (the flag would
        # never be consumed and would linger in the stop set for ever)
        assert api_code(base, token, "POST", f"/v1/sessions/{sid}/teamworks/tw-nope/stop") == 404

        # run on a job with no child agents must fail fast (no LLM needed) -> 400
        assert api_code(base, token, "POST", f"/v1/sessions/{sid}/teamworks/{jid}/run") == 400

        # append a child agent (file I/O, no LLM) -> ok, job gains a worker
        appended = api(base, token, "POST", f"/v1/sessions/{sid}/teamworks/{jid}/workers",
                       {"works": "summarize the project README"})
        assert appended.get("ok") is True, appended
        tw_worker = api(base, token, "GET", f"/v1/sessions/{sid}/teamworks")
        jjob = next(j for j in tw_worker["jobs"] if j["id"] == jid)
        assert len(jjob["workers"]) == 1, jjob
        print("teamwork appended worker:", jjob["workers"][0]["name"])

        # delete the pending job -> ok, then it is gone
        deleted = api(base, token, "DELETE", f"/v1/sessions/{sid}/teamworks/{jid}")
        assert deleted.get("ok") is True, deleted
        tw_gone = api(base, token, "GET", f"/v1/sessions/{sid}/teamworks")
        assert all(j["id"] != jid for j in tw_gone["jobs"]), tw_gone

        # compact: a short conversation returns "already small" but the contract
        # (200 + ok + session echo) holds, and it is safe to call twice
        c1 = api(base, token, "POST", f"/v1/sessions/{sid}/compact")
        assert c1.get("ok") is True and c1.get("session") == sid, c1
        print("compact:", c1.get("status"))
        c2 = api(base, token, "POST", f"/v1/sessions/{sid}/compact")
        assert c2.get("ok") is True and c2.get("session") == sid, c2
        assert api_code(base, token, "POST", f"/v1/sessions/nope-{sid}/compact") == 404
        # a turn must not be running for compact; with none active it is 200
        assert api_code(base, token, "POST", f"/v1/sessions/{sid}/compact") == 200
        # compact must not corrupt the session: it must still answer a turn
        after = api(base, token, "POST", f"/v1/sessions/{sid}/turn", {"text": "still alive after compact?"})
        assert "mock reply" in after.get("output", ""), after
        print("post-compact turn:", after.get("output", "")[:40])

        # ---- file listing: the shell's @-mentions and attachment picker ----
        # Read-only and rooted at the working directory: a path that leaves it
        # must be refused, or the endpoint would enumerate the whole disk for
        # anyone holding the token.
        (work / "probe.txt").write_text("hello")
        (work / "subdir").mkdir(exist_ok=True)
        (work / ".hidden").write_text("no")
        listing = api(base, token, "GET", "/v1/files")
        names = [e["name"] for e in listing["entries"]]
        assert "probe.txt" in names, names
        assert "subdir" in names, names
        assert ".hidden" not in names, f"hidden entries must stay hidden: {names}"
        dirs = [bool(e["dir"]) for e in listing["entries"]]
        assert dirs == sorted(dirs, reverse=True), f"directories sort first: {dirs}"
        rel = {e["name"]: e["path"] for e in listing["entries"]}
        assert rel["probe.txt"] == "probe.txt" and rel["subdir"] == "subdir", rel
        sub = api(base, token, "GET", "/v1/files?path=subdir")
        assert sub["path"] == "subdir", sub
        assert api_code(base, token, "GET", "/v1/files?path=../..") == 400
        assert api_code(base, token, "GET", "/v1/files?path=../../etc") == 400
        print("file listing: entries + workdir containment enforced")

        # ---- file content: the viewer's read side ----
        content = api(base, token, "GET", "/v1/files/content?path=probe.txt")
        assert content["content"] == "hello" and content["name"] == "probe.txt", content
        assert content["binary"] is False and content["truncated"] is False, content
        assert api_code(base, token, "GET", "/v1/files/content") == 400  # missing path
        assert api_code(base, token, "GET", "/v1/files/content?path=../x") == 400
        assert api_code(base, token, "GET", "/v1/files/content?path=subdir") == 400  # a directory is not text
        assert api_code(base, token, "GET", "/v1/files/content?path=nope.txt") == 404
        (work / "big.txt").write_text("x" * 5000)
        big = api(base, token, "GET", "/v1/files/content?path=big.txt&max=1024")
        assert big["truncated"] is True and len(big["content"]) == 1024, (big["truncated"], len(big["content"]))
        (work / "bin.dat").write_bytes(b"\x00\x01\x02abc")
        assert api(base, token, "GET", "/v1/files/content?path=bin.dat")["binary"] is True
        print("file content: read, size cap, binary marking, refusals")

        # ---- log tail ----
        logs = api(base, token, "GET", "/v1/logs?tail=50")
        assert logs["lines"], logs
        assert api(base, token, "GET", "/v1/logs?tail=3")["lines"].__len__() <= 3
        print("log tail:", len(logs["lines"]), "lines")

        # ---- tool events: a call and its result, paired by id ----
        # Tools are off in this fixture, so flip them on for one session; `read`
        # is an allow-policy tool, which keeps the approval dance out of it.
        patched = api(base, token, "PATCH", "/v1/config", {"tools": True})
        assert patched.get("tools") is True, patched
        tsid = api(base, token, "POST", "/v1/sessions")["id"]
        tturn = api(base, token, "POST", f"/v1/sessions/{tsid}/turn", {"text": "读一下 [READ]"})
        tkinds = [e.get("type") for e in tturn.get("events", [])]
        assert "tool_call" in tkinds and "tool_result" in tkinds, tkinds
        call = next(e["data"] for e in tturn["events"] if e.get("type") == "tool_call")
        result = next(e["data"] for e in tturn["events"] if e.get("type") == "tool_result")
        assert call["name"] == "read" and "probe.txt" in call["args"], call
        assert result["id"] == call["id"], (call, result)
        assert result["status"] == "ok", result
        assert "hello" in result["output"], result
        assert result["truncated"] is False, result
        print(f"tool events: {call['name']} -> {result['status']} ({result['seconds']:.2f}s)")


        # ---- skills: inventory, body read, and the /skill load twin ----
        # Skills are scanned fresh from <CELL_ROOT>/skills on every call, so the
        # fixture can be dropped in after the kernel is already serving.
        sk_dir = root / "skills"
        sk_dir.mkdir(parents=True, exist_ok=True)
        (sk_dir / "e2e-helper.md").write_text(
            "---\nname: e2e-helper\ndescription: e2e fixture skill\n---\nDo the e2e thing.\nsecond line\n"
        )
        sk = api(base, token, "GET", "/v1/skills")
        names = [s["name"] for s in sk["skills"]]
        assert "e2e-helper" in names, names
        print("skills:", names)
        one = api(base, token, "GET", "/v1/skills/e2e-helper")
        assert one.get("name") == "e2e-helper", one
        assert "Do the e2e thing." in one.get("content", ""), one
        assert "---" not in one.get("content", ""), "front matter must be stripped"
        assert api_code(base, token, "GET", "/v1/skills/nope-skill") == 404
        loaded = api(base, token, "POST", f"/v1/sessions/{sid}/skills/e2e-helper")
        assert loaded.get("loaded") is True and loaded.get("chars", 0) > 0, loaded
        print("skill loaded:", loaded["name"], loaded["chars"], "chars")
        # the body must now be part of the conversation (like the /skill command)
        msgs2 = api(base, token, "GET", f"/v1/sessions/{sid}/messages")
        entries2 = msgs2.get("messages", msgs2.get("entries", []))
        assert "system" in [m["role"] for m in entries2], [m["role"] for m in entries2]
        assert "Do the e2e thing." in json.dumps(entries2), "loaded skill body not in transcript"
        assert api_code(base, token, "POST", f"/v1/sessions/{sid}/skills/nope-skill") == 404
        assert api_code(base, token, "POST", f"/v1/sessions/nope-{sid}/skills/e2e-helper") == 404

        # ---- a freshly created, still unused session must accept the
        # session-scoped routes: POST /v1/sessions -> create a job / compact /
        # load a skill is the flow the panel drives right after boot, and
        # POST .../turn already accepts such a session. The turn below also
        # proves that loading a skill into it did not cost it its system prompt
        # (ensure_prompt only ever fires on an empty transcript).
        #
        # Creating it HERE also pins a real bug that used to make this impossible:
        # a turn re-keys the live session, and POST /v1/sessions then handed back
        # the id it had just left instead of a new one.
        fresh = api(base, token, "POST", "/v1/sessions")["id"]
        assert fresh != sid, "create after a turn must yield a new session id"
        fresh_dir = root / "sessions" / fresh.split("-")[0] / fresh
        assert not fresh_dir.exists(), "fixture assumption: an unused session has no directory yet"
        loaded2 = api(base, token, "POST", f"/v1/sessions/{fresh}/skills/e2e-helper")
        assert loaded2.get("loaded") is True, loaded2
        job2 = api(base, token, "POST", f"/v1/sessions/{fresh}/teamworks",
                   {"work-type": "serial", "list": []})
        assert job2.get("ok") is True, job2
        assert api(base, token, "POST", f"/v1/sessions/{fresh}/compact").get("session") == fresh
        # an id that is neither on disk nor the active session is still a 404
        assert api_code(base, token, "POST", f"/v1/sessions/ghost-{fresh}/teamworks",
                        {"work-type": "serial", "list": []}) == 404
        turn2 = api(base, token, "POST", f"/v1/sessions/{fresh}/turn", {"text": "fresh session turn"})
        assert "mock reply" in turn2.get("output", ""), turn2
        entries3 = api(base, token, "GET", f"/v1/sessions/{fresh}/messages")
        sys_text = "".join(str(m.get("content", ""))
                           for m in entries3.get("messages", entries3.get("entries", []))
                           if m.get("role") == "system")
        prompt_text = api(base, token, "GET", "/v1/config").get("system_prompt", "")
        assert prompt_text and prompt_text in sys_text, "system prompt missing after a skill load into a fresh session"
        assert "Do the e2e thing." in sys_text, "skill body lost on a fresh session"
        print("fresh session (no dir yet): skill load + job + compact + prompt intact")

        # ---- a notice reaches the running turn as an event ----
        # Two notices mid-turn: one for this session (must arrive) and one for
        # another session (must not — the sink filters by session id).
        nsid = api(base, token, "POST", "/v1/sessions")["id"]
        other = api(base, token, "POST", "/v1/sessions")["id"]

        def post_notices():
            time.sleep(0.6)
            api(base, token, "POST", "/v1/notices", {"session": nsid, "topic": "progress", "body": "worker finished"})
            api(base, token, "POST", "/v1/notices", {"session": other, "topic": "noise", "body": "not this stream"})

        t = threading.Thread(target=post_notices)
        t.start()
        nturn = api(base, token, "POST", f"/v1/sessions/{nsid}/turn", {"text": "慢慢来 [SLOW]"})
        t.join(timeout=20)
        notices = [e["data"] for e in nturn.get("events", []) if e.get("type") == "notice"]
        assert notices and notices[0]["body"] == "worker finished", notices
        assert notices[0]["session"] == nsid and notices[0]["topic"] == "progress", notices
        assert all(n["session"] == nsid for n in notices), f"cross-session notice leaked: {notices}"
        assert "slow" in nturn.get("output", ""), nturn.get("output", "")[:60]
        print("notice event streamed:", notices[0]["topic"], "(cross-session filtered)")

        # ---- export: the browser fallback for the native shell's HTML export --
        esid = api(base, token, "POST", "/v1/sessions")["id"]
        api(base, token, "POST", f"/v1/sessions/{esid}/turn", {"text": "导出前的一句"})
        md = api(base, token, "GET", f"/v1/sessions/{esid}/export?format=md")
        assert md["format"] == "md" and md["count"] >= 2, md
        assert "导出前的一句" in md["markdown"], md["markdown"][:200]
        assert md["markdown"].startswith(f"# cell session {esid}"), md["markdown"][:60]
        # the reply is a transcript, not a terminal dump
        assert "### 你" in md["markdown"] and "### cell" in md["markdown"], md["markdown"][:300]
        js = api(base, token, "GET", f"/v1/sessions/{esid}/export")
        assert js["format"] == "json" and isinstance(js["messages"], list) and js["messages"], js
        assert api_code(base, token, "GET", f"/v1/sessions/{esid}/export?format=pdf") == 400
        assert api_code(base, token, "GET", "/v1/sessions/ghost-x/export?format=md") == 404
        print(f"export: md ({md['count']} messages) + json, refusals")

        # ---- per-worker report: the trace view's sub-agent block ----
        jid = job2.get("job") or job2.get("id") or job2.get("job_id")
        assert jid, job2
        rep = api(base, token, "GET", f"/v1/sessions/{fresh}/teamworks/{jid}/report")
        assert rep["job"] == jid and isinstance(rep["workers"], list), rep
        assert api_code(base, token, "GET", f"/v1/sessions/{fresh}/teamworks/tw-nope/report") == 404
        assert api_code(base, token, "GET", "/v1/sessions/ghost-x/teamworks/tw-x/report") == 404
        added = api(base, token, "POST", f"/v1/sessions/{fresh}/teamworks/{jid}/workers",
                    {"works": "审一遍 SSE 事件"})
        assert added.get("ok") is True, added
        rep2 = api(base, token, "GET", f"/v1/sessions/{fresh}/teamworks/{jid}/report")
        names = [w["name"] for w in rep2["workers"]]
        # the kernel assigns worker names (worker_0, …), so the report is checked
        # by what was appended, not by a name the client asked for
        assert len(names) == len(rep["workers"]) + 1, (names, rep["workers"])
        fresh_worker = rep2["workers"][-1]
        assert fresh_worker["name"] in names, fresh_worker
        assert fresh_worker["works"] == "审一遍 SSE 事件", fresh_worker
        # a child that has not run reports zero rounds and no steps, not a guess
        assert fresh_worker["rounds"] == 0 and fresh_worker["tool_calls"] == 0, fresh_worker
        assert fresh_worker["status"] in ("pending", "running"), fresh_worker
        print(f"teamwork report: {jid} -> {names}")

        # ---- clearing a session (the REST twin of /clear) ----
        csid = api(base, token, "POST", "/v1/sessions")["id"]
        before = api(base, token, "POST", f"/v1/sessions/{csid}/turn", {"text": "先记一句话"})
        assert "mock reply" in before.get("output", ""), before
        cleared = api(base, token, "POST", f"/v1/sessions/{csid}/clear")
        assert cleared["cleared"] is True and cleared["removed"] > 0, cleared
        left = api(base, token, "GET", f"/v1/sessions/{csid}/messages").get("messages", [])
        roles = [m.get("role") for m in left]
        assert "user" not in roles, f"the transcript survived a clear: {roles}"
        assert api_code(base, token, "POST", "/v1/sessions/ghost-x/clear") == 404
        # and the session is still usable afterwards
        again = api(base, token, "POST", f"/v1/sessions/{csid}/turn", {"text": "还在吗"})
        assert "mock reply" in again.get("output", ""), again
        print(f"clear: removed {cleared['removed']} messages, session still usable")

        # a clear while a turn runs is refused, not queued
        busid = api(base, token, "POST", "/v1/sessions")["id"]

        def slow_turn():
            try:
                api(base, token, "POST", f"/v1/sessions/{busid}/turn", {"text": "跑久点 [SLOW]"})
            except Exception:
                pass

        th = threading.Thread(target=slow_turn)
        th.start()
        time.sleep(0.5)
        assert api_code(base, token, "POST", f"/v1/sessions/{busid}/clear") == 409
        th.join(timeout=30)
        print("clear while streaming: 409")

        # ---- handle regression: a worker thread per request must not leak ----
        # The accept loop used to run every connection on a detached thread.
        # Under MinGW/winpthreads detach() never closes the Win32 thread handle,
        # so the kernel leaked exactly one handle per HTTP request — 600 requests
        # grew the handle count by 600, and the GUI polls this server forever.
        # The slack below only covers lazy one-off initialisation; a regression
        # adds one handle per request, so these requests either stay flat or blow
        # straight past the slack. Verified red against the pre-fix binary
        # (60 requests -> +60) and green after it.
        probe, slack = 60, 15
        if sys.platform == "win32":
            before = handle_count(proc.pid)
            for _ in range(probe):
                api(base, token, "GET", "/v1/health")
            after = handle_count(proc.pid)
            assert before and after, "handle count unavailable on Windows"
            print(f"handles: {before} -> {after} over {probe} requests")
            assert after - before <= slack, (
                f"handle leak: {after - before:+d} handles over {probe} requests "
                f"({before} -> {after}) — is a worker thread being detached per "
                f"request? keep it joinable and reap it instead")
        else:
            print("handles: not checked on this platform "
                  "(POSIX detach() leaks nothing; the windows-msys2 job runs it)")

        api(base, token, "POST", "/v1/shutdown")
        proc.wait(timeout=15)
        return True
    except Exception as e:
        print(f"  failed while alive={proc.poll() is None} rc={proc.poll()}")
        try:
            err_file.flush()
            tail = (root / "kernel-stderr.log").read_text(errors="replace")[-8000:]
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
