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
  endpoints (health, version, approvals, notices, usages, skill reads, interrupt,
  shutdown) are answered immediately by the HTTP worker thread; every endpoint
  that touches session/config state (turns, compaction, teamwork control, skill
  *loading*, …) is queued onto the core thread and the worker waits for the
  response.
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

A session-scoped route accepts a `session_id` when its directory exists **or** it
is the session the kernel currently has loaded. A session handed out by
`POST /v1/sessions` is real — and `POST …/turn` accepts it — from the moment it is
created, even though its directory only appears once the transcript is first
written (so "create a session, then create a job / compact / load a skill" works
before the first message). An id that is neither on disk nor active is
`404 session_not_found`, which also means a crafted id cannot steer a write
anywhere: it never resolves to a path.

### Errors

```json
{ "error": { "code": "session_not_found", "message": "no session with id 'abc-123'" } }
```

| HTTP | `code` | Meaning |
| --- | --- | --- |
| 400 | `bad_request` | malformed JSON / missing field / invalid enum value |
| 401 | `unauthorized` | missing or wrong bearer token |
| 404 | `not_found`, `session_not_found`, `skill_not_found`, `job_not_found` | unknown route / session / skill / teamwork job / provider / approval |
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
| ✅ | `POST /v1/sessions/{id}/compact` | `/compact` (archive + summarize); 409 `busy` while a turn runs, 404 for an unknown session; body `{session, status, compacted, ok}` |
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

Skills are `.md` files under `.cell/skills/`, (re)scanned on every call — there is
no install/enable API because there is no registry to write to; dropping a file
in the directory *is* the install step. The two write-free reads plus the
`/skill` load twin are served:

| Status | Endpoint | Notes |
| --- | --- | --- |
| ✅ | `GET /v1/skills` | `{skills:[{name, description, file}]}` from `.cell/skills/` |
| ✅ | `GET /v1/skills/{name}` | one skill's full body, front matter stripped (`404 skill_not_found`; names come from front matter/file stem, not the path) |
| ✅ | `POST /v1/sessions/{id}/skills/{name}` | load a skill into a session — the REST twin of the CLI `/skill NAME`: the body joins the leading system block. `{session, name, loaded, chars}`; `404` unknown session/skill; `409 busy` while a turn runs |
| ✅ | `GET /v1/usages` | `.cell/usages.json` (`{models:{…}, sessions:{…}}`; records carry `cached_tokens`/`prompt_tokens` when the provider reports a prompt cache) |
| ✅ | `GET /v1/files?path=` | one directory level under the session's working directory, for the shell's `@`-mentions and its attachment picker: `{cwd, path, entries:[{name, path, dir, size, mtime}], truncated}`, hidden entries skipped, directories first, paths relative to the workdir. `400 path_outside_workdir` when the path escapes the workdir (symlinks resolved first) |
| 🚧 | `GET /v1/logs?tail=N` | tail of `.cell/logs/cell.log` |

### 3.9 Teamwork

The job store and background runner already exist internally (`/teamworks …`).
The **read** side is served, and the **control** side is now served too: jobs can
be created, edited, removed, run/resumed in the background, stopped cooperatively,
and have child agents appended/removed — all over REST.

| Status | Endpoint | Notes |
| --- | --- | --- |
| ✅ | `GET /v1/sessions/{id}/teamworks` | this session's jobs as JSON (`404` for an unknown session) |
| ✅ | `GET /v1/teamworks` | every session's jobs across all working directories, each tagged with its `session` id |
| ✅ | `POST /v1/sessions/{id}/teamworks` | create a job; body is the job config (`work-type`, `list`, …); returns `{id, session, ok}`; `400 invalid_job` on a bad config; `404` for an unknown session |
| ✅ | `PATCH /v1/sessions/{id}/teamworks/{job}` | edit a **pending** job (`400 edit_failed` on a running/completed job) |
| ✅ | `DELETE /v1/sessions/{id}/teamworks/{job}` | remove a job that is **not running and not completed** (`400 remove_failed`). Completed jobs stay protected on this channel on purpose: it is reachable by anything holding the token, including the agent itself, whereas the CLI `/teamworks rm` is a trusted human channel and can drop them |
| ✅ | `POST /v1/sessions/{id}/teamworks/{job}/run` | run the job **in the background** (non-blocking; `400 run_failed` if it has no child agents or is already running). Poll `GET …/teamworks` for progress. |
| ✅ | `POST /v1/sessions/{id}/teamworks/{job}/resume` | resume a gated/stopped job from its saved stage (same background semantics as `run`) |
| ✅ | `POST /v1/sessions/{id}/teamworks/{job}/stop` | cooperative stop — the runner pauses at the next round/stage boundary; `404 job_not_found` for an unknown job |
| ✅ | `POST /v1/sessions/{id}/teamworks/{job}/workers` | append a child agent to a **pending** job; body is the worker extras (`provider`, `model`, `think`, `works`, `rules`, …) |
| ✅ | `DELETE /v1/sessions/{id}/teamworks/{job}/workers/{worker}` | remove a child agent from a **pending** job |
| 🚧 | `GET /v1/teamworks/{job}/report` | per-worker transcript/report (the list already returns per-worker `status`/`rounds`/`tool_calls`) |

`run`/`resume` are **background** by design: a teamwork job runs many LLM rounds,
so the HTTP worker must not block on it. The runner is the same machinery the CLI
`/teamworks run_bg` uses, so progress arrives as notices and the job's `status`
advances in its store (`pending → running → completed` / `failed`; a cooperative
stop parks it at `waiting` with a `stopped` flag, which `resume` picks up).
`stop` is cooperative (the engine checks the flag between rounds), matching the
CLI `/teamworks stop`.

Each job is:

```json
{ "id": "job-3", "session": "abc", "status": "running", "work_type": "serial",
  "error": "", "created": "2026-10-15 11:00", "current_stage": 0,
  "is_workflow": true, "workflow_name": "release",
  "stages": [{ "name": "build", "mode": "serial", "gate": false, "workers": 2 }],
  "workers": [{ "name": "w0", "stage": 0, "provider": "openai", "model": "gpt-4o",
                "status": "done", "rounds": 3, "tool_calls": 11 }] }
```

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
| ✅ | `token` | `{text}` | one assistant text delta, as decoded from the provider stream. A GUI renders this instead of the raw `output` capture |
| ✅ | `reasoning` | `{text}` | one chain-of-thought delta (OpenAI `reasoning_content`, Anthropic thinking) |
| ✅ | `tool_call` | `{id, name, args}` | the model proposed a tool call, before any sandbox decision |
| ✅ | `tool_result` | `{id, name, status, seconds, output, truncated}` | that call finished; `id` is the pairing key (two calls to the same tool is the normal case). `status` is the kernel's `ok`/`failed`/`unknown`/`exception`/`blocked`, and `output` is capped at 16 KiB with `truncated` set — the full text is in the transcript |
| ✅ | `usage` | `{in_tokens, out_tokens, total_tokens, cached_tokens, prompt_tokens, request_ms, decode_ms}` | one measurement per LLM request (a turn with tool calls has several). `decode_ms` runs from the first token, so `out_tokens / decode_ms` is a decode rate rather than a flattered one |
| ✅ | `interrupt` | `{partial_chars}` | a cancel was observed: the partial answer is final, not still arriving |
| 🚧 | `notice` | `{…}` | notices posted for the running session, streamed instead of polled |

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
   `reasoning` / `tool_call` / `tool_result` / `usage` / `interrupt` events, which
   the turn engine emits through a process-wide sink that only the service layer
   installs — the CLI pays one null check per delta.
2. ~~Teamwork endpoints over the existing job store + `run_bg`.~~ ✅ done
   (create / edit / remove / run / resume / stop / append-worker / remove-worker;
   see §3.9). Remaining: per-worker `report` read (🚧).
3. ~~`/compact`~~ ✅ done (§3.5); ~~skill reads + `/skill` load~~ ✅ done (§3.8).
   Remaining: `/clear`, archives, HTML export, logs tail.
4. SSE `Last-Event-ID` resume for interrupted streams; notices `follow=true`.

**Later (P2)** — multi-turn parallelism per session, TLS/reverse-proxy
guidance, CORS allow-list, approval audit log stored next to the transcript.
