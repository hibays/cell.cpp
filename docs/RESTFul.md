# cell.cpp — REST / SSE API specification

> **Status: design specification (not yet implemented).**
>
> cell.cpp today ships three programmatic surfaces:
> 1. the **CLI** (`cell` executable — interactive REPL and one-shot stdin),
> 2. the **embedding API** — `cell.h` / `cell.dll` with `cell_main`,
>    `cell_run_oneshot`, `cell_version`, `cell_selftest`, `cell_free`
>    (see [BUILDING.md](BUILDING.md) §5),
> 3. the **file contracts** under `.cell/` (`config.json`, `messages.jsonl`,
>    `sessions.json`, `notices/`, `teamworks.json`, `usages.json`).
>
> This document specifies the **service layer** (`cell --serve`) that turns those
> capabilities into a network API a GUI can drive directly. Every endpoint below
> maps to an internal capability that already exists in the single-file agent —
> the mapping is listed for each endpoint (§7 summarizes it). Nothing in this
> document requires new agent behaviour, only a transport layer and the
> `turn_engine` extraction described in §9.

---

## 1. Overview

| | |
| --- | --- |
| **Default bind** | `127.0.0.1:8737` (loopback only; see §6) |
| **Base path** | `/v1` |
| **Content type** | `application/json; charset=utf-8` (requests and responses) |
| **Streaming** | `text/event-stream` (Server-Sent Events) for turns and notices |
| **Auth** | `Authorization: Bearer <token>` — token printed at startup / stored in `.cell/server.json` |
| **Versioning** | path-based (`/v1`); additive changes only within a major version |
| **Concurrency** | one active turn per session; different sessions run in parallel |

Server startup:

```bash
cell --serve                # 127.0.0.1:8737, token auto-generated
cell --serve --port 9000 --host 127.0.0.1
cell --serve --token "$CELL_SERVER_TOKEN"     # CI / managed deployments
```

The server runs inside the same process as the agent core, so the existing
process-wide entry lock (see `cell.h`) applies: requests that run a turn are
serialized per session, and session-global state (config, sandbox mode) is
protected by the same mutex the CLI paths use.

---

## 2. Conventions

### Identifiers

* `session_id` — `<cwd-key>-<timestamp>-<rand>` exactly as today
  (`session` folders, `messages.jsonl`).
* `job_id` — Teamwork job id (e.g. `job-3`), `worker` — child agent name.
* `request_id` — server-assigned, stable for the lifetime of a request
  (used by SSE events and approval decisions).

### Timestamps

ISO-8601 UTC (`2026-10-14T09:15:22Z`).

### Errors

```json
{
  "error": {
    "code": "session_not_found",
    "message": "no session with id 'abc-123'",
    "detail": { "session_id": "abc-123" }
  }
}
```

| HTTP | `code` | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | malformed JSON / missing field |
| 401 | `unauthorized` | missing or wrong bearer token |
| 404 | `not_found` | unknown session / job / provider |
| 409 | `busy` | a turn is already running in this session |
| 409 | `not_configured` | no provider registered yet |
| 422 | `sandbox_blocked` | operation refused by the sandbox mode |
| 500 | `internal` | unexpected failure (details in `.cell/logs/cell.log`) |
| 503 | `approval_required` | a `Policy::Ask` tool needs a decision (see §3.5) |

### Pagination

List endpoints accept `?limit=<1..500>&before=<cursor>`; responses carry
`"next_cursor": "<string|null>"`.

---

## 3. Endpoints

### 3.1 Meta

#### `GET /v1/health`

```json
{ "status": "ok", "version": "0.1.0", "uptime_s": 421,
  "provider": "openai", "model": "gpt-4o",
  "sandbox_mode": "full-access", "active_turns": 1 }
```

#### `GET /v1/version`

```json
{ "version": "0.1.0", "git": "<sha>", "build": "<compiler/toolchain>" }
```

### 3.2 Providers and models

| Endpoint | Body / query | Mirrors |
| --- | --- | --- |
| `GET /v1/providers` | — | `/provide`, `config.providers` |
| `POST /v1/providers` | `{ "style": "openai", "base": "...", "model": "...", "key": "...", "proxy": null, "name": "optional" }` | `/provide add` |
| `PATCH /v1/providers/{name}` | any of `base` / `key` / `proxy` / `model` | `/provide set` |
| `DELETE /v1/providers/{name}` | — | `/provide rm` |
| `POST /v1/providers/{name}/select` | `{ "model": "gpt-4o" }` | `/model` |
| `GET /v1/providers/{name}/models` | `?refresh=true` | `/models` (live probe, the `fetch_models` path) |

Provider styles: `openai` (Chat Completions), `openai-responses`, `anthropic` —
the three protocol clients in `cell::llm`. API keys are **write-only**: the
server never returns them (they live in the encrypted vault `.cell/.crypt`);
responses only report `"key_set": true`.

### 3.3 Configuration

#### `GET /v1/config`

Returns the effective settings (the `.cell/config.json` contract):

```json
{
  "think_level": 2,
  "think_levels": ["off", "low", "med", "high", "max"],
  "tools": true,
  "sandbox_mode": "full-access",
  "autoallow": false,
  "compact_auto": true,
  "compact_provider": null,
  "compact_model": null,
  "system_prompt": "You are a helpful assistant...",
  "teamwork_max_children": 5,
  "max_threads": 16
}
```

#### `PATCH /v1/config`

Accepts any subset of the above. Field-level semantics match the slash
commands exactly (e.g. `autoallow` is only effective in `full-access`;
`think_level` accepts both the name and the integer 0–4). `sandbox_mode` and
`autoallow` changes are refused (422 `sandbox_blocked`) while a turn is running.

### 3.4 Sessions

| Endpoint | Body / query | Notes |
| --- | --- | --- |
| `GET /v1/sessions` | `?cwd=<path>&limit=` | the `/sessions` listing as JSON (id, cwd, model, updated_at, msg_count, title) |
| `POST /v1/sessions` | `{ "cwd": "D:/work/repo", "system_prompt": null, "provider": null, "model": null }` | create a fresh session (`/new`) |
| `GET /v1/sessions/{id}` | — | metadata + interrupt state |
| `GET /v1/sessions/{id}/messages` | `?after=<n>&limit=` | `messages.jsonl` parsed (role/content/tool_calls/reasoning/ts) |
| `DELETE /v1/sessions/{id}` | — | `/session rm` (deletes the folder) |
| `POST /v1/sessions/{id}/clear` | — | `/clear` (keeps the file, resets context) |
| `POST /v1/sessions/{id}/compact` | `{ "model": null }` | `/compact` (archive + summarize; refuses on ≤12 messages like the CLI) |
| `GET /v1/sessions/{id}/archives` | — | `/saved list` |
| `POST /v1/sessions/{id}/export` | `{ "archive": null, "format": "html" }` | `/export` — returns `{ "path": "cell-export-....html" }`; the file is the same self-contained renderer the CLI writes |

`cwd` is a real directory the agent will operate in. The server maps it to the
session-store key (`session_prefix`) exactly like the CLI does.

### 3.5 Running turns — `POST /v1/sessions/{id}/turn`

The core endpoint. Request:

```json
{ "text": "explain what this repo does",
  "stream": true,
  "overrides": { "think_level": 3, "sandbox_mode": "edit-only" } }
```

* `text` — the user message (UTF-8). Required unless `"resume": true`.
* `"resume": true` — continue an interrupted turn (`/reload`).
* `"ins": "…"` — queue an interjection instead of starting a turn (`/ins`).
* `stream: false` — wait for completion and return the final assistant message
  (same shape as the last `turn_done` event, plus `"messages_added"`).

**With `stream: true` the response is `text/event-stream`** — see §4 for the
event schema. The stream ends after `turn_done` (or `error`).

Related:

| Endpoint | Meaning | Mirrors |
| --- | --- | --- |
| `POST /v1/sessions/{id}/interrupt` | request cancellation — sets the turn's cancel flag; the partial reply is kept and `interrupt.json` persisted | terminal `Esc` |
| `POST /v1/sessions/{id}/reload` | resume the interrupted turn | `/reload` |
| `POST /v1/sessions/{id}/think` | `{ "level": "high" }` per-session CoT level | `/think` |
| `POST /v1/sessions/{id}/skills/{name}` | load a skill into the session context | skills injection |

Only one turn may run per session at a time: a second `POST .../turn` while a
turn is active returns `409 busy`.

### 3.6 Approvals

`exec` (and `tw run` in gated configurations) go through `Policy::Ask`. In the
CLI that is a y/N prompt; over HTTP it becomes an explicit decision resource:

#### `GET /v1/approvals?session={id}`

```json
{ "pending": [
    { "request_id": "ap-7",
      "session_id": "…", "tool": "exec",
      "args": { "cmd": "npm run build" },
      "risk": "high", "created_at": "2026-10-14T09:15:22Z",
      "expires_at": "2026-10-14T09:25:22Z" } ],
  "policy": { "sandbox_mode": "full-access", "autoallow": false } }
```

#### `POST /v1/approvals/{request_id}`

```json
{ "decision": "allow" }        // or { "decision": "deny", "reason": "run only in CI" }
```

While an approval is pending, the turn blocks and the SSE stream emits
`approval_request`; the client answers with this endpoint (or the request
expires → automatic deny, matching the fail-closed CLI behaviour). The
`approval_prompt` callback in `cell::tools::runtime` is exactly the seam this
endpoint bridges; the CLI keeps using its console implementation.

### 3.7 Teamwork (child-agent jobs)

| Endpoint | Body | Mirrors |
| --- | --- | --- |
| `GET /v1/teamworks` | `?all=true` | `/teamworks` (list) |
| `POST /v1/teamworks` | `{ "work_type": "serial\|parallel\|workflow", "works": ["…"], "stages": [ … ] }` — or `{ "config_path": "teamwork.workflow.json" }` | `/teamworks …`, `/teamworks workflow FILE` |
| `POST /v1/teamworks/{id}/run` | — | `/teamworks run ID` (gated stage pauses the job) |
| `POST /v1/teamworks/{id}/run_bg` | — | background runner (`tw run_bg`) |
| `POST /v1/teamworks/{id}/stop` | — | cooperative stop |
| `POST /v1/teamworks/{id}/resume` | — | `/teamworks resume ID` |
| `GET /v1/teamworks/{id}/status` | — | `/teamworks status ID` (stage plan, gates, progress) |
| `GET /v1/teamworks/{id}/history` | — | `/teamworks history` |
| `GET /v1/teamworks/{id}/report` | `?worker=<name>` | consolidated/per-child report |
| `POST /v1/teamworks/{id}/append` | `{ "work": "…", "provider": "…", "model": "…", "think": "med", "reuse": "job-1/worker", "writes": ["src/a.cpp"], "rules": "…", "name": "…" }` | `/teamworks id:ID …` (append a child task) |

Background jobs progress through the same SSE channel as turns when
`GET /v1/notices?session={id}` is subscribed (notices are the mechanism
Teamwork already uses to report progress to a running session).

### 3.8 Notices (cross-process bus)

The agent's `cell::notice` file bus (`.cell/notices/`, atomic writes,
`pending/` + `seen.jsonl`) is exposed as:

* `GET /v1/notices?session={id}&follow=true` — SSE/long-poll stream of notices
  for a session; `follow=false` returns the pending batch (equivalent to the
  `peek`/`drain` pair).
* `POST /v1/notices` — `{ "session": "…", "topic": null, "body": "…" }`
  publishes a notice (equivalent to the `notice` tool). Useful for a GUI that
  wants to inject external context ("screenshot attached", "user switched
  branch") into the agent's next turn.

### 3.9 Skills and usage

| Endpoint | Notes |
| --- | --- |
| `GET /v1/skills` | scan `.cell/skills/` (recursive, directory-style supported) → name, description, path, size |
| `GET /v1/usages` | `.cell/usages.json`: per-model and per-session requests / tokens / chars / prompt-cache hit rate (`/usages` as JSON) |
| `GET /v1/logs?tail=200` | tail of `.cell/logs/cell.log` (diagnostics pane) |

---

## 4. SSE event schema

Each event is a JSON object in the `data:` field; `id:` carries a monotonically
increasing sequence number so a client can resume with `Last-Event-ID`.

```json
{ "id": 42, "seq": 4211, "ts": "2026-10-14T09:15:22Z",
  "session": "…", "request": "rq-9", "type": "token",
  "data": { "text": "The repository" } }
```

| `type` | `data` | When |
| --- | --- | --- |
| `turn_start` | `{ "model": "openai:gpt-4o", "round": 1, "ctx_msgs": 12 }` | a turn begins |
| `reasoning` | `{ "text": "…" }` | chain-of-thought delta (`reasoning_content` / `thinking_delta`) |
| `token` | `{ "text": "…" }` | assistant text delta |
| `tool_call` | `{ "call_id": "call_1", "name": "read", "args": { "file": "README.md" } }` | model requests a tool |
| `tool_result` | `{ "call_id": "call_1", "ok": true, "summary": "read 214 lines", "truncated": false }` | tool finished (`ToolOutput.ok` + metadata) |
| `approval_request` | `{ "request_id": "ap-7", "tool": "exec", "args": { … }, "risk": "high" }` | a `Policy::Ask` call is waiting |
| `notice` | `{ "topic": null, "body": "worker 2: stage done" }` | notice folded into the turn |
| `usage` | `{ "tok_in": 7342, "tok_out": 512, "cache": "n/a", "round": 1 }` | per-round accounting |
| `compact` | `{ "reason": "auto", "before_msgs": 84, "after_msgs": 9 }` | automatic/manual compaction |
| `interrupt` | `{ "reason": "user" }` | cancellation acknowledged |
| `turn_done` | `{ "message": { "role": "assistant", "content": "…" }, "turns": 3, "stopped": false }` | terminal (success) |
| `error` | `{ "code": "llm", "message": "stream request failed", "attempts": 5 }` | terminal (failure) |

Text is streamed as `token`/`reasoning` deltas — the same callbacks the console
renderer consumes (`on_token` / `on_reason` in `cell::llm::chat_stream`), so a
GUI gets exactly what the terminal shows, in structured form.

Heartbeat: a comment line (`: ping`) every 15 s keeps proxies from closing idle
streams.

---

## 5. Example flows

### Start a turn (curl)

```bash
TOKEN=$(jq -r .token .cell/server.json)

curl -N -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"text":"explain what this repo does","stream":true}' \
     http://127.0.0.1:8737/v1/sessions/$SID/turn
```

### Consume events (browser / Electron)

```js
const es = new EventSource(`http://127.0.0.1:8737/v1/sessions/${sid}/turn`, …);
// EventSource cannot send bodies — use fetch + ReadableStream in browsers,
// or POST with a stream reader; the event format is identical.
for await (const ev of sseStream) {
  const e = JSON.parse(ev.data);
  if (e.type === "token")    render(e.data.text);
  if (e.type === "tool_call") showToolCard(e.data);
  if (e.type === "approval_request") askUser(e.data.request_id);
}
```

### Decide an approval

```bash
curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"decision":"allow"}' \
     http://127.0.0.1:8737/v1/approvals/ap-7
```

---

## 6. Security

* **Loopback by default.** `--host 0.0.0.0` requires an explicit flag *and* a
  token; the server refuses to start without one.
* **Bearer token** — generated on first start, stored in `.cell/server.json`
  (0600), printed once to stderr. `--token` for managed environments.
* **Sandbox is authoritative.** HTTP access never widens the sandbox: the same
  `check_action` gates apply (`read-only` refuses write/exec tool calls;
  credential files under `.cell/` stay blocked; path-traversal checks unchanged).
* **Settings protection.** `PATCH /v1/config` refuses sandbox relaxation while a
  turn runs; `autoallow` remains writable only in `full-access` (same rule as
  `/autoallow`).
* **No secret egress.** Provider keys are never returned, only `key_set`.
* **CORS** — disabled by default; `--serve --allow-origin http://localhost:5173`
  for a local web UI (dev only).
* **TLS** — not terminated by the server; put it behind a reverse proxy when it
  must leave the loopback interface.

---

## 7. Implementation mapping

Everything the endpoints need already exists in `cell.cpp`; a service layer
mostly re-shapes it.

| API surface | Internal capability (verified) |
| --- | --- |
| session list / create / clear / remove | `cell::chat::history` (`now/get/use/forget_current/remove`), `sessions.json` index |
| messages | `cell::chat::session::msg()`, `messages.jsonl` parse/dump |
| turn execution | the agent loop currently inside `repl::run()` — extract as `turn_engine` (§9) |
| token/reasoning deltas | `cell::llm::chat_stream(on_token, on_reason, …)` |
| tool call/result events | `cell::tools::callable_tool`, `ToolOutput{ok,text,blocks}`; currently text-wrapped for the model |
| approvals | `cell::tools::runtime::approval_prompt` callback (console today) |
| interrupt | the turn's cancel flag + `interrupt.json` persistence |
| config | `cell::config::settings` (field list in §3.3) |
| providers / models | `cell::config` + the `fetch_models` probe |
| skills | `cell::skills` |
| usage | `cell::stats` / `usages.json` |
| teamwork | `cell::teamwork` job store + `run_bg` runner; `runtime_context` injection |
| notices | `cell::notice` **already a cross-process file bus** — the SSE endpoint just tails it |
| export | the `cell::chat` self-contained HTML renderer used by `/export` |

---

## 8. Relationship to the embedding (DLL) API

| Need | Today | After the service layer |
| --- | --- | --- |
| run the CLI in-process | `cell_main(argc, argv)` | unchanged |
| one message → one reply | `cell_run_oneshot()` (captures stdout+stderr, no approvals, whole-turn granularity) | `POST /turn` with `stream:false` |
| token streaming | not exposed | SSE `token`/`reasoning` events |
| tool-call visibility | text only | `tool_call` / `tool_result` events |
| approvals from a GUI | impossible (fail-closed) | `GET/POST /approvals` |
| session enumeration | file reads (`sessions.json`) | `GET /sessions` |
| background child agents | `tw run_bg` + notices | `POST /teamworks/{id}/run_bg` + SSE |

A desktop front-end can therefore be built in two stages: ship the DLL today
(`cell_run_oneshot` covers chat-shaped UIs), then switch to HTTP/SSE when the
service layer lands — the header keeps the same version-free ABI.

---

## 9. Roadmap

**P0 — transport + turn engine**
1. Extract the agent turn from `repl::run()` into a `turn_engine` that emits
   structured events through a sink (console renderer and SSE writer become two
   sinks). This is the enabling refactor for every streaming endpoint.
2. `cell --serve` with `/health`, `/sessions*`, `/turn` (SSE), `/interrupt`,
   `/config`, `/providers*`.
3. Async approvals (`approval_prompt` → request/response with ids) + `/approvals`.

**P1 — observability and orchestration**
4. `/teamworks*`, `/notices` (SSE), `/usages`, `/logs`, `/skills`.
5. Structured tool metadata in `ToolOutput` (keep the text form for the model —
   prompt-injection wrappers depend on it — add a parallel structured field for
   the UI).
6. JSON forms for every slash command's data (`/sessions`, `/usages`,
   `/teamworks` share the same formatter as the REST layer).

**P2 — deployment hardening**
7. Multi-cwd routing, per-session locks, `Last-Event-ID` resume for SSE.
8. Optional TLS / reverse-proxy guidance, CORS allow-list, audit log of
   approvals written next to the session transcript.

The expected net-new code is concentrated in the transport layer and the
`turn_engine` extraction; the sandbox, vault, LLM clients, session store,
teamwork machinery and notice bus are reused as-is.
