# cellui desktop GUI — redesign & capability plan

Status: **design + phase 1 in progress.** This document is the contract between
the kernel's service layer and the desktop shell's front-end. It says what the
shell must be able to show, which kernel capability each screen needs, and which
techniques we borrowed from `deepseek-harness`'s `web` profile (a much larger
product whose UI solves the same problems).

Reference: `deepseek-harness` (read-only study), `packages/boot/app-boot/src/profile.ts`
defines the profile `web = { bundles: [dsh-base, dsh-web-app] }`; its UI lives in
`packages/client/*` (~170k LOC, React + a Cordis slot system). We take **ideas and
numbers**, never code: our shell is a ~7k-line Vue SPA that must stay a single
inlined `dist/index.html` (it is embedded in the binary by
`webui/scripts/embed_webui.mjs`), so bundle size and dependency count are hard
constraints, and the harness's framework machinery (slots/plugins, Lexical
composer, dock kit) is explicitly out of scope.

## 1. What the reference GUI is

Anatomy of the target screen, top to bottom:

| region | what it does | kernel capability it needs |
| --- | --- | --- |
| **Sidebar** | brand row; `新会话`; a plugin entry; a **Workspace section** that groups sessions, with search, and one row per session showing *title + relative age*; settings fixed at the bottom | session list with `title`, `mtime`, `messages`, `cwd` (for grouping) |
| **Header** | session title, status chips (`N 个子智能体`, mode), per-session actions, and a **`对话 / 轨迹` switch** | teamwork jobs + turn ledger |
| **Conversation** | rich markdown (numbered/bulleted lists, bold runs, inline code chips, links, tables), **file cards** for attachments, and a per-message action bar (copy / like / dislike / comment / share / timestamp) | transcript + streaming deltas + attachment metadata |
| **Composer** | rounded multi-line box: `+` (attachments), **permission selector** (`完全权限`), **model selector**, send/stop; placeholder advertises `/` commands and `@` file/conversation mentions | config (sandbox mode, model), providers list, sessions/skills/files for mentions |
| **Telemetry strip** | `N 轮 M 步 X tok/s`, total tokens with **cache-hit %**, context usage % | per-turn stats + usage counters |

## 2. Capability matrix

### 2.1 Kernel (service layer) — `cell.cpp`

| id | capability | today | why the UI needs it |
| --- | --- | --- | --- |
| **B1** | structured turn events: `reasoning`, `token`, `tool_call`, `tool_result`, `usage`, `interrupt`, `notice` | ✅ done (P3) except `notice` | the 轨迹 tab, per-turn stats and *streaming* tool cards all need semantics; without them the client must re-fetch the transcript after every turn |
| **B2** | session metadata in `GET /v1/sessions`: `title`, `updated_at`, `messages`, `cwd` | `id`, `cwd`, `messages`, `snippet` | grouping + relative age + search in the sidebar; without `updated_at` the list cannot be ordered or grouped by recency |
| **B3** | teamwork detail: `GET /v1/teamworks/{job}/report`, per-worker status/rounds/tools | jobs list + reports only through the CLI/`tw` tool | the "N 个子智能体" chip and the trace view's sub-agent section |
| **B4** | per-turn stats: turns, steps (tool calls), decode tok/s, ttft, token totals, cache hit | ✅ done (P3) via the `usage` event (`decode_ms` from the first token, so the rate is honest); turns/steps come from the transcript | the telemetry strip |
| **B5** | `GET /v1/files?path=` (workspace listing) | ✅ done (P2) | `@` file mentions and the attachment picker |
| **B6** | `GET /v1/logs?tail=N` | ✅ done (P4) | the right bar's diagnostics tab |
| **B7** | `GET /v1/sessions/{id}/clear`, `archives`, `export` (documented 🚧) | ✗ | session hygiene in the sidebar |

B1/B2/B4 are on the critical path for phase 1–3; B3 unlocks the trace tab's
sub-agent view; B5–B7 are later.

### 2.2 Front-end (Vue) — `webui/frontend`

| id | capability | phase |
| --- | --- | --- |
| **F1** | two-layer design tokens (`--cell-static-*` palette → `--cell-alias-*` semantics) + light/dark switch; typography, radius, spacing, motion scales | 1 |
| **F2** | three-column CSS grid shell (`sidebar / main / rightbar`) with rAF-throttled drag handles, collapsed rail (<1024 px) and persisted widths | 1 |
| **F3** | sidebar: workspace grouping, 250 ms-debounced search, relative age, state dot, per-group fold quota, "new session", settings/plugins at the bottom | 1 |
| **F4** | view tabs `对话 / 轨迹`: the trace view is a per-turn ledger (turns → steps → tool calls/diffs/sub-agents) built from B1 | 1 (v1 from transcript), 3 (live) |
| **F5** | composer: multi-line input, `+` attachments, `/` command palette, `@` mentions, model / permission / think selectors, one-turn send queue | 2 |
| **F6** | telemetry strip: turns, steps, tok/s, token totals, cache-hit %, context ring | 1 (usage), 3 (live per-turn) |
| **F7** | streaming markdown: freeze completed blocks, re-render only the tail, publish on rAF | 2 |
| **F8** | semantic-anchor scrolling: capture anchor on read gestures, reserve space below, toggle `overflow-anchor` while following | 1 (extend `scrollAnchor.ts`) |
| **F9** | code highlighting, sized for the inline bundle | 2 |
| **F10** | message action bar (copy / feedback / timestamp) and code-block copy; file cards with a preview tab are P4 | 2 |
| **F11** | approval takes over the composer, `Y` / `N` keys, risk line | 2 |

## 3. What we borrow from the harness (with the numbers)

| technique | source | what we take |
| --- | --- | --- |
| three-column solver | `packages/client/ui-layout/src/client/columns.ts` (59 lines) + `AppFrame.tsx` (307) | grid template string, constants `CENTER_MIN=400 / SIDEBAR_MIN=264 / SIDEBAR_MAX=420 / SIDEBAR_DEFAULT=280 / SIDEBAR_COLLAPSED=56 / SIDEBAR_AUTO_COLLAPSE=1024 / RIGHTBAR_MAX_RATIO=0.7 / RIGHTBAR_DEFAULT_RATIO=0.45`; JS decides discrete state, CSS solves the squeeze |
| token layers | `packages/client/ui-theme/src/styles/design-platform.css` (408) + `base.css` | two layers (`static` palette → `alias` semantics) and `body[data-*-theme]` for the dark override; theme applied by writing DOM attributes, not by a framework |
| drag handles | `AppFrame.tsx` `DragHandle` | pointer capture + one `requestAnimationFrame` per gesture, `ResizeObserver` on the frame (never on `window`) |
| semantic-anchor scrolling | `packages/client/ui-chat/src/client/chat/use-chat-viewport.ts` (555) | anchor capture on `READING_INTENTS = ['wheel','touchstart','pointerdown','keydown','beforematch']`, `reserveBelow()` spacers so the scrollport cannot clamp, and `overflow-anchor: none` only while following |
| rAF publication | `ui-conversation/src/client/conversation/assembler.ts` `PUBLICATION_RANK` | high-frequency deltas merge into an animation frame, durable updates publish immediately |
| session browser | `ui-workspace/src/client/rows/{WorkspaceBrowser,Rows,tree}.tsx` | grouping/sort derivation as pure functions, `SEARCH_DEBOUNCE_MS = 250`, `COLLAPSED_SESSION_LIMIT = 5`, `relativeTime` + state dot |
| telemetry | `ui-chat/.../StatsPills.tsx`, `ContextMeter.tsx` (180) | `WindowStats { turns, steps, llmMs, toolMs, ttftMs, decodeMs, decodeTokens }`, two pills, and a ring + per-slice bar for context |
| markdown rules | `ui-primitives/src/markdown/render.tsx` (760) | tables with ≥4 columns get a wide (overflow) treatment instead of wrapping; raw HTML stays literal text |
| backoff reconnect | `client/connection/src/client/connection.ts` | exponential backoff with jitter, `online`/`offline` awareness |

**Not ported:** the Cordis slot/plugin registry (`ui-slots` 1.7k lines), the
Lexical composer stack (`facade.ts` 902 + `input-trigger` 643), and the dock kit
(`ui-dockkit` 5k). All three exist to serve a plugin marketplace; a Vue SPA with
`provide/inject` and named slots gets 90% of the value for 5% of the size.
Their *models* are still worth copying: a submit state machine, a `/`+`@` trigger
pipeline, and reversible panel operations.

## 4. Phases and gates

Each phase ships with the repo's existing gates green — `bun test` (front-end
units), `vue-tsc --noEmit`, `vite build` + `embed_webui.mjs`, `cell.cellui_boot`
(SPA marker + icon id inside the binary), `ctest` (`selftest`, `e2e_serve`).

- **P1 — shell & navigation (done).** F1 tokens, F2 grid shell, F3 sidebar, F4
  tabs v1, F6 usage strip, F8 anchor extension, plus kernel **B2**
  (`title` / `updated_at`).
- **P2 — input & content (done).** F5 composer (attachments, `/` commands with
  argument completion, `@` mentions, model / permission / think selectors, a
  one-turn send queue), F7 streaming markdown with a frozen-block cache, F9
  highlighting, F10 message action bar + code copy, F11 approval takeover with
  `Y` / `N`; plus kernel **B5** (read-only file listing, sandboxed to the
  working directory) which is what makes `@` files and the attachment picker
  real rather than decorative.
- **P3 — semantic stream (done).** Kernel **B1**: the turn engine emits `token`,
  `reasoning`, `tool_call`, `tool_result`, `usage` and `interrupt` through a
  process-wide sink that only the service layer installs (the CLI pays one null
  check per delta), paired by tool-call id and capped where a live stream should
  not carry a transcript. **B4** rides on the `usage` event, whose `decode_ms`
  starts at the first token so the decode rate is measured rather than flattered.
  The shell folds the events into a live turn (lib/liveTurn.ts) and renders
  reasoning, tool cards, tok/s and cache hit *while the turn runs*; the trace tab
  shows the running turn instead of waiting for it to end.
- **P4 — depth (done, except as listed).** B6 logs tail, `notice` events streamed
  with a per-session filter, and the right-hand panel is real: 文件 (browse the
  workdir + a capped, highlighted viewer), 改动 (files this session has written or
  edited, derived from the transcript's mutating tool calls — no endpoint needed),
  日志 (the log tail, polled only while the tab is on screen). The viewer reads
  through `GET /v1/files/content`, which is sandboxed to the workdir and marks
  binary files rather than shipping mojibake. **Still open:** B3 (per-worker
  `GET /v1/teamworks/{job}/report`), B7 session hygiene (`/clear`, archives,
  export), diff review inside the viewer, and uploaded (as opposed to
  referenced) attachments.

## 5. Non-goals and constraints

- No new runtime framework: Vue 3 + plain CSS, no Tailwind, no component library.
- No new server dependency, and no second wire protocol: HTTP + the existing SSE
  turn stream stays the only channel (`docs/RESTful.md` is the contract; new
  events land there first).
- The shell must still work in a plain browser (`bun run dev`) with the native
  bridge absent — every bridge call keeps its graceful degradation.
- `dist/index.html` is inlined into the binary: the front-end has a size budget
  of roughly 1 MiB, so highlighting and markdown are chosen for size, not
  features.
