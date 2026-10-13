# cell.cpp — REST / SSE API

> **Status: implemented (P0 subset).** `cell --serve` starts the service layer
> described here; every endpoint marked ✅ below is implemented, verified
> end-to-end against a mock OpenAI-compatible server, and the transport helpers
> are covered by the binary's self-test. Endpoints marked 🚧 are the remaining
> roadmap (tracked at the bottom).
>
> The agent core is unchanged: the service layer is an additive surface on top
> of the same session loop the CLI runs (see [BUILDING.md](BUILDING.md) for the
> build-side view and `include/cell.h` for the in-process embedding API).

---

## 1. Overview

| | |
| --- | --- |
| **Start** | `cell --serve [--port N] [--host ADDR] [--token T]` |
| **Default bind** | `127.0.0.1:8737` (loopback; `--port 0` picks a free port) |
| **Base path** | `/v1` |
| **Content type** | `application/json; charset=utf-8` (requests and responses) |
| **Streaming** | `text/event-stream` for turns (`Accept: text/event-stream` or `?stream=1`) |
| **Auth** | `Authorization: Bearer <token>` — or `?token=<token>` for clients that cannot set headers (browser `EventSource`). `/v1/health` is open. |
| **Discovery** | `.cell/server.json` **next to the executable** — `{host, port, token, pid, started_at}` |
| **Runtime root** | `.cell/` lives next to the binary (portable layout), not in the working directory |

```console
$ cell --serve --port 8737
cell serve: listening on http://127.0.0.1:8737
cell serve: bearer token: 5f0c…a91
cell serve: discovery file: /path/to/bin/.cell/server.json
```

### Execution model (important for clients)

* One **core thread** owns the live session and the configuration. Control
  endpoints (health, version, approvals, notices, usages, skills, interrupt,
  shutdown) are answered immediately by the HTTP worker thread; every endpoint
  that touches session/config state is queued onto the core thread and the
  worker waits for the response.
* **One turn runs at a time** (the core is single-threaded). A second
  `POST …/turn` while one is running returns `409 busy`.
* Turn output is streamed at **text level** (`output` events carrying the same
  bytes the terminal would show). Token-level `token`/`reasoning` events,
  `tool_call`/`tool_result` events and per-round `usage` events arrive with the
  `turn_engine` extraction (🚧 roadmap) — until then the truth is: one `output`
  stream per turn.
* **Approvals are asynchronous**: a `Policy::Ask` tool (e.g. `exec`) blocks the
  core thread and emits `approval_request` on the running turn's stream; the
  decision is posted to `/v1/approvals/{id}` (300 s window, then fail-closed,
  exactly like the non-interactive CLI).

---

## 2. Conventions

### Identifiers

* `session_id` — `<cwd-key>-<timestamp>-<rand>` exactly as the CLI creates them.
* `request_id` — e.g. `ap-6ace6d2c-0`, stable for the pending approval.
* Jobs/teamwork keep their existing ids (`job-N`, worker names).

### Errors

```json
{ "error": { "code": "session_not_found", "message": "no session with id 'abc-123'" } }
```

| HTTP | `code` | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | malformed JSON / missing field / invalid enum value |
| 401 | `unauthorized` | missing or wrong bearer token |
| 404 | `not_found` | unknown route / session / provider / approval |
| 409 | `busy`, `no_turn` | a turn is already running · interrupt with no turn |
| 413 | `payload_too_large` | request head > 64 KiB or body > 16 MiB |
| 422 | `sandbox_blocked`, `notices_rejected` | refused by the sandbox · notice rejected |
| 500 | `internal` | unexpected failure (details in `.cell/logs/cell.log`) |
| 502 | `provider_unreachable` | the models probe could not reach the provider |
| 503 | `shutting_down` | the server is stopping |

---

## 3. Endpoints

### 3.1 Meta

| Status | Endpoint | Notes |
| --- | --- | --- |
| ✅ | `GET /v1/health` | **no auth**; `{status, version, uptime_s, provider, model, session, sandbox_mode, turn_active}` — snapshot refreshed by the core thread |
| ✅ | `GET /v1/version` | `{version}` |
| ✅ | `POST /v1/shutdown` | graceful stop; the core loop drains, the server closes, exit code 0 |

### 3.2 Providers and models

| Status | Endpoint | Notes |
| --- | --- | --- |
| ✅ | `GET /v1/providers` | `{providers:[{name, api_style, base, proxy, key_set, current}], current_model}` — **never returns key material** |
| ✅ | `POST /v1/providers` | `{api_style\|style, name?, base?, key?, proxy?, model?}` — creates (201) or updates (200); `key` goes into the encrypted vault |
| ✅ | `DELETE /v1/providers/{name}` | removes provider + vault key; re-points the current selection like `/provide rm` |
| ✅ | `POST /v1/providers/{name}/select` | `{model?}` → becomes the current provider/model |
| ✅ | `GET /v1/providers/{name}/models` | live probe (same code path as `/models`); 502 when unreachable |

### 3.3 Configuration

| Status | Endpoint | Notes |
| --- | --- | --- |
| ✅ | `GET /v1/config` | effective settings: `think_level(+think_levels)`, `tools`, `sandbox_mode`, `autoallow`, `compact_auto/provider/model`, `system_prompt`, `teamwork_max_children`, `max_threads`, `current_provider`, `current_model`, `session_id` |
| ✅ | `PATCH /v1/config` | any subset; unknown enum values → 400. `sandbox_mode` / `autoallow` are applied to the running sandbox immediately and persisted; `max_threads` re-configures the tool worker pool |

### 3.4 Sessions

| Status | Endpoint | Notes |
| --- | --- | --- |
| ✅ | `GET /v1/sessions` | `{sessions:[{id, cwd, messages, snippet}], current}` — the `/sessions` scan as JSON (flushes queued writes first) |
| ✅ | `POST /v1/sessions` | creates a fresh current session → `201 {id, cwd, previous}` (equivalent of `/new`; uses the server's working directory) |
| ✅ | `GET /v1/sessions/{id}/messages?after=N&limit=M` | transcript entries verbatim (`role`/`content`/tool calls/reasoning); 404 when the session has no transcript yet |
| ✅ | `DELETE /v1/sessions/{id}` | removes the session folder; 409 while a turn runs in it |
| 🚧 | `POST /v1/sessions/{id}/clear` | `/clear` (reset context, keep the file) |
| 🚧 | `GET /v1/sessions/{id}/archives` | `/saved list` |
| 🚧 | `POST /v1/sessions/{id}/export` | the self-contained HTML exporter (`/export`) |

### 3.5 Running turns

#### ✅ `POST /v1/sessions/{id}/turn`

Request body:

```json
{ "text": "explain what this repo does",   // or "ins": "…" (alias)
  "resume": false }                        // true = continue an interrupted turn (/reload)
```

* `stream` (query `?stream=1` or `Accept: text/event-stream`) → **SSE** (§4).
* otherwise → one JSON response after the turn finishes:
  `{rc, interrupted, output, events:[…]}` where `output` is the concatenated text.

Response headers for SSE: `Content-Type: text/event-stream`, `Connection: close`,
no caching. The stream ends with `turn_done` (or `error`).

| Status | Endpoint | Notes |
| --- | --- | --- |
| ✅ | `POST /v1/sessions/{id}/turn` | 409 `busy` while another turn runs; 400 without `text`/`resume` |
| ✅ | `POST /v1/sessions/{id}/interrupt` | sets the same cancel flag the CLI's Esc key uses → the turn stops at the next streaming callback, keeps partial output, records an interrupt state (409 `no_turn` when idle) |
| ✅ | `POST /v1/sessions/{id}/turn` with `{"resume": true}` | ⤴ this is `/reload` |
| 🚧 | `POST /v1/sessions/{id}/compact` | `/compact` (archive + summarize) |
| 🚧 | `POST /v1/sessions/{id}/think` | covered today by `PATCH /v1/config {"think_level": …}` |

### 3.6 Approvals (implemented)

| Status | Endpoint | Notes |
| --- | --- | --- |
| ✅ | `GET /v1/approvals` | `{pending:[{request_id, tool, args}], turn_active}` |
| ✅ | `POST /v1/approvals/{id}` | `{decision:"allow"}` or `{"decision":"deny","reason":"…"}`; 404 for unknown/expired ids |

The CLI's console prompt and this endpoint are two implementations of the same
`tools::runtime::approval_prompt` seam: the CLI asks the terminal, the server
asks the HTTP client, both fail closed.

### 3.7 Notices

| Status | Endpoint | Notes |
| --- | --- | --- |
| ✅ | `GET /v1/notices?session={id}` | pending batch (`peek`) as JSON |
| ✅ | `POST /v1/notices` | `{session?, topic?, body}` → `{id}`; feeds the agent's next turn exactly like the `notice` tool |
| 🚧 | `GET /v1/notices?follow=true` | SSE/long-poll subscription |

### 3.8 Skills, usage

| Status | Endpoint | Notes |
| --- | --- | --- |
| ✅ | `GET /v1/skills` | `{skills:[{name, description, file}]}` from `.cell/skills/` |
| ✅ | `GET /v1/usages` | `.cell/usages.json` (`{models:{…}, sessions:{…}}`) |
| 🚧 | `GET /v1/logs?tail=N` | tail of `.cell/logs/cell.log` |

### 3.9 Teamwork (🚧 roadmap)

`GET/POST /v1/teamworks`, `POST /v1/teamworks/{id}/run|run_bg|stop|resume`,
`GET /v1/teamworks/{id}/status|history|report` — the job store, background
runner and notice-driven progress already exist internally (`/teamworks …`);
they need the same queue+JSON treatment as the endpoints above.

---

## 4. SSE event schema (implemented subset)

Each event is one `data: <json>` line; the JSON is `{"type": …, "data": {…}}`.

| Status | `type` | `data` | When |
| --- | --- | --- | --- |
| ✅ | `turn_start` | `{session, model}` | a turn begins |
| ✅ | `output` | `{text}` | a chunk of the CLI text stream (tokens, tool banners, final reply) — arbitrary byte chunks |
| ✅ | `approval_request` | `{request_id, tool, args}` | a `Policy::Ask` tool waits for `POST /v1/approvals/{id}` |
| ✅ | `turn_done` | `{rc, interrupted}` | terminal: turn finished (`rc` 0/1, `interrupted` reflects a cancel) |
| ✅ | `error` | `{code, message}` | terminal: internal failure inside the turn |
| 🚧 | `token` / `reasoning` | `{text}` | semantic deltas (needs the turn-engine extraction) |
| 🚧 | `tool_call` / `tool_result` | `{call_id, name, args}` / `{call_id, ok, …}` | structured tool events |
| 🚧 | `usage` / `notice` / `compact` / `interrupt` | … | per-round accounting and lifecycle events |

---

## 5. Verified example session

```bash
TOKEN=$(python -c "import json;print(json.load(open('bin/.cell/server.json'))['token'])")
AUTH="Authorization: Bearer $TOKEN"
B=http://127.0.0.1:8737/v1

# health needs no auth; everything else does
curl -s $B/health
curl -s -H "$AUTH" $B/version

# list / create sessions
curl -s -H "$AUTH" $B/sessions
SID=$(curl -s -H "$AUTH" -X POST $B/sessions | python -c "import json,sys;print(json.load(sys.stdin)['id'])")

# run a turn, streaming
curl -sN -H "$AUTH" -H 'Content-Type: application/json' -H 'Accept: text/event-stream' \
     -d '{"text":"explain this repo"}' $B/sessions/$SID/turn

# approvals while a turn is blocked
curl -s -H "$AUTH" $B/approvals
curl -s -H "$AUTH" -X POST -H 'Content-Type: application/json' \
     -d '{"decision":"allow"}' $B/approvals/ap-6ace6d2c-0

# one-shot settings change, then graceful stop
curl -s -H "$AUTH" -X PATCH -H 'Content-Type: application/json' -d '{"think_level":"low"}' $B/config
curl -s -H "$AUTH" -X POST $B/shutdown
```

These flows are exercised end-to-end in this repository against a local mock
OpenAI-compatible server (streamed turns, SSE framing, the `exec` approval
round-trip, session persistence, graceful shutdown).

---

## 6. Security

* **Loopback by default.** `--host 0.0.0.0` is explicit opt-in; the token is
  always required (auto-generated, printed once, stored in `.cell/server.json`).
* **Sandbox is authoritative.** HTTP never widens it: `check_action` gates apply
  (read-only refuses write/exec; credential files under `.cell/` stay blocked;
  path-traversal checks unchanged); `PATCH /v1/config` is the only way to change
  `sandbox_mode`, and it persists.
* **Approvals fail closed** — no decision within 300 s means deny.
* **No secret egress** — vault keys are write-only over HTTP (`key_set` only).
* **No CORS / TLS** yet: keep it on loopback; front it with a reverse proxy if
  it must leave the machine (🚧 hardening step).

---

## 7. Relationship to the embedding (DLL) API

| Need | `cell.dll` (today) | `cell --serve` (today) |
| --- | --- | --- |
| run the CLI in-process | `cell_main(argc, argv)` | — |
| one message → one reply | `cell_run_oneshot()` (whole turn, no approvals) | `POST /turn` (JSON) |
| streamed output | 🚧 | ✅ SSE `output` events |
| approvals from a GUI | refused (fail-closed) | ✅ `GET/POST /approvals` |
| session enumeration | file reads | ✅ `GET /sessions`, `GET /sessions/{id}/messages` |
| token-level events | 🚧 | 🚧 (turn-engine extraction) |

---

## 8. Roadmap

**Done (P0)** — transport, core turn execution, session/provider/config
management, approvals, notices, usage, skills, graceful shutdown.

**Next (P1)**
1. `turn_engine` extraction out of `repl::run()` → semantic `token` /
   `reasoning` / `tool_call` / `tool_result` / `usage` events.
2. Teamwork endpoints over the existing job store + `run_bg`.
3. `/compact`, `/clear`, archives, HTML export, logs tail.
4. SSE `Last-Event-ID` resume for interrupted streams; notices `follow=true`.

**Later (P2)** — multi-turn parallelism per session, TLS/reverse-proxy
guidance, CORS allow-list, approval audit log stored next to the transcript.
