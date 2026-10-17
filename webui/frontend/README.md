# frontend — cell desktop UI

Vue 3 + TypeScript SPA that runs inside the `cellui` shell (WebView2 on Windows,
WKWebView on macOS, webui's default browser backend on Linux). It talks to the
in-process agent over the REST/SSE service layer (`cell --serve`, see
[../docs/RESTful.md](../docs/RESTful.md)) and uses a small native bridge
(`window.cell.*`, implemented in `../cellui.cpp`) for shell integration and the
HTML exports.

## Toolchain

| Tool | Version | Role |
| --- | --- | --- |
| bun | 1.4+ | package manager + scripts |
| Node | 22+ | only needed to run the embed script |
| Vue | 3.5.x (3.6 → vapor) | UI framework, Composition API + `<script setup>` |
| Vite | 8 | dev server + production build (rolldown) |
| vite-plugin-singlefile | 2.3 | one self-contained `dist/index.html` |
| oxlint / oxfmt | latest | lint + format (`bun run lint`, `bun run fmt`) |
| gsap | 3.15 | animations (landing reveal, pulses) |
| vgpu | 0.6 | WebGPU shader host for the landing hero |

### Vapor mode

Vue 3.6 ships the `vapor` compiler flag. The published `vue` here is 3.5.x, so
`vite.config.ts` enables vapor **automatically once `vue` is >= 3.6**
(`bun update vue`). Everything is written against the plain Composition API, so
the switch needs no code change — the build log states which mode is active.

## Commands

```bash
bun install            # install dependencies
bun run dev            # dev server on http://localhost:5173 (needs the native bridge absent → 浏览器模式)
bun run build          # type-check + single-file bundle into dist/
bun run lint           # oxlint (type-aware)
bun run fmt            # oxfmt (format in place)
bun run fmt:check      # oxfmt --check
```

The build output `frontend/dist/index.html` is embedded into the `cellui`
binary by `../scripts/embed_webui.mjs` (run automatically by the CMake build
when the dist exists).

## Layout

```
src/
  main.ts / App.vue        entry + phase router (landing / onboarding / app)
  lib/api.ts               typed REST + SSE client (turns, approvals, config…)
  lib/bridge.ts            window.cell.* wrappers (export, reveal, openExternal)
  lib/markdown.ts          markdown-lite renderer (same subset as /export)
  lib/format.ts            time / number / session-title formatting
  lib/motion.ts            GSAP helpers
  lib/shortcuts.ts         global keyboard shortcuts
  store/index.ts           one reactive store (sessions, turns, approvals, toasts)
  views/                   LandingView (shader) · OnboardingView · ChatShell · SettingsView
  components/              MessageItem · ToolCallCard · ApprovalCard · Composer ·
                           Sidebar · StatusBar · ToastHost · CommandPalette ·
                           ExportPanel · HeroShader
  styles/                  tokens.css (design tokens) · markdown.css (v-html body)
```

## Human touches (borrowed from mature coding agents)

* command palette (`Ctrl/Cmd+K`), `Ctrl/Cmd+N` new session, `Ctrl/Cmd+B`
  sidebar, `Esc` interrupt, `Ctrl/Cmd+Enter` resume, `1..9` session jump
* onboarding when no provider is registered (key goes to the encrypted vault)
* approval cards with command highlighting, risk badge and Y/N keys
* streaming cursor, per-turn token/usage meter, session titles from the first
  message, empty states with starter prompts, toasts for every action
* export centre: current / selected batch / all sessions

## Native bridge (from cellui.cpp)

| JS call | Native behaviour |
| --- | --- |
| `cell_bootstrap()` | version, api base URL + bearer token, platform, the host shell that actually came up (`webview2` / `browser`) |
| `cell_export_session(id)` | renders the session HTML through cell.cpp's own exporter; lands in the user's Downloads folder unless a path is given |
| `cell_export_batch([ids])` | batch export (same destination) |
| `cell_export_all()` | every session on disk (same destination) |
| `cell_reveal(path)` | show the exported file in the file manager; `{ok}` / `{ok:false,error}` — failures are said, not swallowed |
| `cell_open_external(url)` | open a URL in the default browser; same result shape |
| `cell_native_capabilities()` | what the native layer provides today (reports the real shell, not the hoped-for one) |
| `cell_notify(text)` | placeholder for native notifications (in-app toast for now) |
