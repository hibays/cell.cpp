// Typed client for the in-process agent service (`cell --serve`, see
// docs/RESTful.md). One base URL + one bearer token, discovered at runtime
// through the native bridge (cell_bootstrap).

/** Resolve a native bridge function by name.
 *
 * webui publishes bound C++ functions as *globals* (`window.cell_bootstrap`),
 * while the shell contract also allows a `window.cell.*` namespace. This is
 * the single resolution point — it is what made the landing page report
 * "kernel not ready" when only the global form existed.
 */
export function resolveNative(name: string): ((...args: unknown[]) => Promise<string>) | undefined {
  const g = globalThis as unknown as Record<string, unknown>
  const ns = g['cell'] as Record<string, unknown> | undefined
  const inNs = ns ? ns[name] : undefined
  if (typeof inNs === 'function') return inNs as (...args: unknown[]) => Promise<string>
  const flat = g[name]
  if (typeof flat === 'function') return flat as (...args: unknown[]) => Promise<string>
  return undefined
}

export interface Bootstrap {
  version: string
  serve_ok: boolean
  serve_error: string
  uptime_s: number
  platform: [string, number]
  api?: { base: string; token: string }
}

export interface SessionSummary {
  id: string
  cwd: string
  messages: number
  /** First user turn clipped to 60 chars (kept for older callers). */
  snippet: string
  /** First user turn, newlines folded, up to 120 chars — the sidebar row label. */
  title: string
  /** Transcript mtime, Unix seconds — what the sidebar groups and sorts by. */
  updated_at: number
}

/** One usage record from `usages.json`; counters accumulate per session and per model. */
export interface UsageRecord {
  requests?: number
  messages?: number
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  /** Prompt tokens served from the provider's cache, and the prompt total they are measured against. */
  cached_tokens?: number
  prompt_tokens?: number
  input_chars?: number
  output_chars?: number
}

/** One entry of a directory listing (paths are relative to the workdir). */
export interface FileEntry {
  name: string
  path: string
  dir: boolean
  /** Bytes, or -1 when it cannot be read. */
  size: number
  /** Unix seconds, 0 when unknown. */
  mtime: number
}

/** One file's content for the viewer; `binary` means there is no `content` to show. */
export interface FileContent {
  path: string
  name: string
  size: number
  mtime: number
  truncated: boolean
  binary: boolean
  content: string
}

export interface LogTail {
  path: string
  size?: number
  truncated: boolean
  lines: string[]
}

export interface FileListing {
  cwd: string
  /** The listed directory, relative to the workdir ("." for the root). */
  path: string
  entries: FileEntry[]
  truncated: boolean
}

export interface ProviderEntry {
  name: string
  api_style: string
  base: string
  proxy: string
  key_set: boolean
  current: boolean
}

export interface ConfigSnapshot {
  think_level: number
  think_levels: string[]
  tools: boolean
  sandbox_mode: string
  autoallow: boolean
  compact_auto: boolean
  compact_provider: string
  compact_model: string
  system_prompt: string
  teamwork_max_children: number
  max_threads: number
  current_provider: string
  current_model: string
  session_id: string
}

export interface Approval {
  request_id: string
  tool: string
  args: string
}

/**
 * What one LLM request cost, as the kernel measured it. `decode_ms` runs from
 * the first token, so `out_tokens / decode_ms` is a decode rate; `request_ms`
 * includes the prompt upload and would flatter it.
 */
export interface UsageEvent {
  in_tokens: number
  out_tokens: number
  total_tokens: number
  cached_tokens: number
  prompt_tokens: number
  request_ms: number
  decode_ms: number
}

export type TurnEvent =
  | { type: 'turn_start'; data: { session: string; model: string } }
  | { type: 'output'; data: { text: string } }
  | { type: 'approval_request'; data: Approval }
  | { type: 'turn_done'; data: { rc: number; interrupted: boolean } }
  | { type: 'error'; data: { code: string; message: string } }
  // semantic events: the answer as it arrives, the tool calls as they happen,
  // and what each request cost — the shell renders structure from these instead
  // of re-reading the transcript once the turn is over
  | { type: 'token'; data: { text: string } }
  | { type: 'reasoning'; data: { text: string } }
  | { type: 'tool_call'; data: { id: string; name: string; args: string } }
  | {
      type: 'tool_result'
      data: { id: string; name: string; status: string; seconds: number; output: string; truncated: boolean }
    }
  | { type: 'usage'; data: UsageEvent }
  | { type: 'interrupt'; data: { partial_chars: number } }
  | { type: 'notice'; data: { id: string; session: string; from: string; topic: string; body: string; created_at: number } }

export interface TurnResult {
  rc: number
  interrupted: boolean
  output: string
  events: TurnEvent[]
}

export interface ApiError {
  status: number
  code: string
  message: string
}

// ---- teamwork + compaction (REST contract in docs/RESTful.md §3.9) ----------
// Both sides are live: the read endpoints, the control endpoints
// (create/edit/remove job, run/resume/stop, append/remove worker) and the
// manual compact trigger.

export interface TeamworkStage {
  name: string
  mode: string
  gate: boolean
  workers?: number
}

export interface TeamworkWorker {
  name: string
  stage: number
  stage_name: string
  provider: string
  model: string
  status: string
  rounds?: number
  tool_calls?: number
}

export interface TeamworkJob {
  id: string
  session: string
  status: string
  work_type: string
  error: string
  created: string
  current_stage: number
  is_workflow: boolean
  workflow_name?: string
  stages: TeamworkStage[]
  workers: TeamworkWorker[]
}

/** One child agent's report: what it did, and on request its transcript. */
export interface WorkerReport {
  name: string
  works: string
  provider: string
  model: string
  status: string
  rounds: number
  tool_calls: number
  summary?: string
  reviews_approved?: number
  reviews_denied?: number
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  has_transcript?: boolean
  transcript_bytes?: number
  messages?: number
  transcript?: unknown[]
}

export interface TeamworkReport {
  session: string
  job: string
  status: string
  work_type: string
  created: string
  workers: WorkerReport[]
}

export interface TeamworkList {
  session?: string
  jobs: TeamworkJob[]
}

export interface CompactResult {
  session: string
  status: string
  compacted: boolean
  ok: boolean
}

/** One child-agent entry as the create/append endpoints accept it.
 *
 * `works` is the task text; the kernel normalizes everything else (name,
 * provider/model defaults, file grants) — see normalize_worker_item. The
 * panel only ever needs `works` (+ an optional explicit `name`).
 */
export interface TeamworkWorkerInput {
  works: string
  name?: string
  provider?: string
  model?: string
}

/** Body of the create endpoint: a flat worker list or a named workflow. */
export interface TeamworkJobInput {
  'work-type'?: 'serial' | 'parallel'
  list?: TeamworkWorkerInput[]
}

/** Uniform reply of every teamwork control endpoint. `message` carries the
 *  kernel's human-readable detail (e.g. why a run was refused). */
export interface TeamworkAction {
  id: string
  session: string
  ok: boolean
  worker?: string
  message?: string
}

/** One skill's full body (front matter stripped). */
export interface SkillDetail {
  name: string
  description: string
  file: string
  content: string
}

/** Reply of the skill-load endpoint (the REST twin of the /skill command). */
export interface SkillLoadResult {
  session: string
  name: string
  loaded: boolean
  chars: number
}

/** Parse JSON and check the minimal shape the bridge/API promises. */
export function parseJson<T>(text: string): T | null {
  try {
    const value: unknown = JSON.parse(text)
    if (value === null || typeof value !== 'object') return null
    return value as T
  } catch {
    return null
  }
}

export class ApiClient {
  base = ''
  token = ''

  async bootstrap(): Promise<Bootstrap> {
    // resolveNative: webui exposes bound functions as globals
    // (window.cell_bootstrap), while the shell contract historically used a
    // window.cell.* namespace — accept both, and let dev mode degrade.
    //
    // The WebUI bridge is constructed on DOMContentLoaded, but this ES module
    // executes *before* DOMContentLoaded, so the bind can be absent for a moment
    // right after load. Poll briefly instead of failing the first time.
    const fn = await this.waitForBridge('cell_bootstrap')
    if (!fn) throw new Error('native bridge unavailable (dev mode)')
    return parseJson<Bootstrap>(await fn())!
  }

  /** Poll for a native bridge function to become available (handles the
   *  DOMContentLoaded race between this module and WebUI's bridge setup). */
  private async waitForBridge(
    name: string,
    tries = 40,
    gapMs = 50,
  ): Promise<((...args: unknown[]) => Promise<string>) | undefined> {
    for (let i = 0; i < tries; i++) {
      const fn = resolveNative(name)
      if (fn) return fn
      await new Promise((r) => setTimeout(r, gapMs))
    }
    return undefined
  }

  private authHeaders(extra?: HeadersInit): Headers {
    const headers = new Headers(extra)
    headers.set('Content-Type', 'application/json')
    headers.set('Authorization', `Bearer ${this.token}`)
    return headers
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.base) throw new Error('the agent service is not available')
    const res = await fetch(`${this.base}${path}`, { ...init, headers: this.authHeaders(init.headers) })
    const text = await res.text()
    const json: unknown = text ? parseJson<unknown>(text) : {}
    if (!res.ok) {
      const err = parseJson<{ error?: ApiError }>(text)
      throw Object.assign(new Error(err?.error?.message ?? `HTTP ${res.status}`), {
        status: res.status,
        code: err?.error?.code ?? 'unknown',
      } satisfies Partial<ApiError>)
    }
    return json as T
  }

  // ---- meta -----------------------------------------------------------------
  health() {
    return fetch(`${this.base}/health`).then((r) => r.json())
  }

  version() {
    return this.request<{ version: string }>('/version')
  }

  shutdown() {
    return this.request<{ status: string }>('/shutdown', { method: 'POST' })
  }

  // ---- sessions -------------------------------------------------------------
  listSessions() {
    return this.request<{ sessions: SessionSummary[]; current: string }>('/sessions')
  }

  createSession() {
    return this.request<{ id: string; cwd: string; previous: string }>('/sessions', { method: 'POST' })
  }

  sessionMessages(id: string, after = 0, limit = 0) {
    const q = new URLSearchParams()
    if (after) q.set('after', String(after))
    if (limit) q.set('limit', String(limit))
    return this.request<{ messages: unknown[] }>(`/sessions/${encodeURIComponent(id)}/messages?${q}`)
  }

  deleteSession(id: string) {
    return this.request<{ deleted: string }>(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  // ---- turns ----------------------------------------------------------------
  /** One-shot turn: resolves when the turn finishes. */
  async turn(sessionId: string, text: string): Promise<TurnResult> {
    return this.request<TurnResult>(`/sessions/${encodeURIComponent(sessionId)}/turn`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    })
  }

  async resume(sessionId: string): Promise<TurnResult> {
    return this.request<TurnResult>(`/sessions/${encodeURIComponent(sessionId)}/turn`, {
      method: 'POST',
      body: JSON.stringify({ resume: true }),
    })
  }

  /**
   * Streaming turn: consumes the SSE stream and yields events as they arrive.
   * The browser EventSource cannot POST, so this reads the body manually.
   */
  async streamTurn(
    sessionId: string,
    text: string,
    onEvent: (e: TurnEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const headers = this.authHeaders()
    headers.set('Accept', 'text/event-stream')
    const res = await fetch(`${this.base}/sessions/${encodeURIComponent(sessionId)}/turn?stream=1`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text }),
      signal,
    })
    if (!res.ok || !res.body) {
      const t = await res.text().catch(() => '')
      throw new Error(t || `HTTP ${res.status}`)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- stream frames arrive in order
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        const line = frame.split('\n').find((l) => l.startsWith('data: '))
        if (!line) continue
        const event = parseJson<TurnEvent>(line.slice(6))
        if (event) onEvent(event)
      }
    }
  }

  /** Streaming continuation of an interrupted turn (`resume: true`). */
  streamResume(sessionId: string, onEvent: (e: TurnEvent) => void, signal?: AbortSignal): Promise<void> {
    const headers = this.authHeaders()
    headers.set('Accept', 'text/event-stream')
    return fetch(`${this.base}/sessions/${encodeURIComponent(sessionId)}/turn?stream=1`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ resume: true }),
      signal,
    }).then(async (res) => {
      if (!res.ok || !res.body) throw new Error((await res.text().catch(() => '')) || `HTTP ${res.status}`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        // oxlint-disable-next-line no-await-in-loop -- stream frames arrive in order
      const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        let idx: number
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          const line = frame.split('\n').find((l) => l.startsWith('data: '))
          if (!line) continue
          const event = parseJson<TurnEvent>(line.slice(6))
          if (event) onEvent(event)
        }
      }
    })
  }

  interrupt(sessionId: string) {
    return this.request<{ status: string }>(`/sessions/${encodeURIComponent(sessionId)}/interrupt`, {
      method: 'POST',
    })
  }

  // ---- approvals ------------------------------------------------------------
  listApprovals() {
    return this.request<{ pending: Approval[]; turn_active: boolean }>('/approvals')
  }

  decideApproval(id: string, decision: 'allow' | 'deny', reason = '') {
    return this.request<{ request_id: string; decision: string }>(`/approvals/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify({ decision, reason }),
    })
  }

  // ---- teamwork + compaction ------------------------------------------------
  /** Teamwork jobs for one session (read-only; control endpoints are roadmap). */
  getSessionTeamworks(sessionId: string) {
    return this.request<TeamworkList>(`/sessions/${encodeURIComponent(sessionId)}/teamworks`)
  }

  /** Teamwork jobs across every session. */
  getTeamworks() {
    return this.request<TeamworkList>('/teamworks')
  }

  /**
   * Per-worker report for one job. The counters come from the run itself; the
   * transcript is included only when asked for, because a worker can be big.
   */
  teamworkReport(sessionId: string, jobId: string, transcript = false) {
    return this.request<TeamworkReport>(
      `/sessions/${encodeURIComponent(sessionId)}/teamworks/${encodeURIComponent(jobId)}/report` +
        (transcript ? '?transcript=1' : ''),
    )
  }

  /**
   * Clear a session's context: transcript, interrupt state, recorded reads and
   * its teamwork store. 409 while a turn or a background job is running.
   */
  clearSession(sessionId: string) {
    return this.request<{ session: string; cleared: boolean; removed: number; jobs: number }>(
      `/sessions/${encodeURIComponent(sessionId)}/clear`,
      { method: 'POST' },
    )
  }

  /** The transcript as JSON, for a browser that has no native export. */
  async exportSession(sessionId: string): Promise<{ json: string; messages: number }> {
    const r = await this.request<{ messages: unknown[] }>(
      `/sessions/${encodeURIComponent(sessionId)}/messages?limit=0`,
    )
    const messages = r.messages ?? []
    return { json: JSON.stringify({ session: sessionId, messages }, null, 2), messages: messages.length }
  }

  /** Manually compact a session's context. 409 while a turn runs, 404 unknown. */
  compactSession(sessionId: string) {
    return this.request<CompactResult>(`/sessions/${encodeURIComponent(sessionId)}/compact`, {
      method: 'POST',
    })
  }

  // ---- teamwork control -----------------------------------------------------
  // Paths mirror docs/RESTful.md §3.9. Failures arrive as ApiError with a
  // stable code (invalid_job / edit_failed / remove_failed / run_failed /
  // append_failed / remove_worker_failed / session_not_found).

  private tw(sessionId: string, jobId?: string, tail = ''): string {
    const base = `/sessions/${encodeURIComponent(sessionId)}/teamworks`
    const job = jobId ? `/${encodeURIComponent(jobId)}` : ''
    return `${base}${job}${tail}`
  }

  /** Create a pending job (`{work-type, list:[{works}]}`). */
  createTeamworkJob(sessionId: string, body: TeamworkJobInput) {
    return this.request<TeamworkAction>(this.tw(sessionId), { method: 'POST', body: JSON.stringify(body) })
  }

  /** Replace a pending job's definition (refused while running/completed). */
  patchTeamworkJob(sessionId: string, jobId: string, body: TeamworkJobInput) {
    return this.request<TeamworkAction>(this.tw(sessionId, jobId), {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  }

  /** Remove a pending job. */
  deleteTeamworkJob(sessionId: string, jobId: string) {
    return this.request<TeamworkAction>(this.tw(sessionId, jobId), { method: 'DELETE' })
  }

  /** Cooperative stop: the runner pauses at its next round/stage boundary. */
  stopTeamworkJob(sessionId: string, jobId: string) {
    return this.request<TeamworkAction>(this.tw(sessionId, jobId, '/stop'), { method: 'POST' })
  }

  /** Start the job in the background (200 immediately; 400 run_failed when the
   *  job has no child agents or is already running). */
  runTeamworkJob(sessionId: string, jobId: string) {
    return this.request<TeamworkAction>(this.tw(sessionId, jobId, '/run'), { method: 'POST' })
  }

  /** Continue a stopped job. */
  resumeTeamworkJob(sessionId: string, jobId: string) {
    return this.request<TeamworkAction>(this.tw(sessionId, jobId, '/resume'), { method: 'POST' })
  }

  /** Append one child agent to a pending job. */
  appendTeamworkWorker(sessionId: string, jobId: string, worker: TeamworkWorkerInput) {
    return this.request<TeamworkAction>(this.tw(sessionId, jobId, '/workers'), {
      method: 'POST',
      body: JSON.stringify(worker),
    })
  }

  /** Remove one child agent from a pending job. */
  removeTeamworkWorker(sessionId: string, jobId: string, worker: string) {
    return this.request<TeamworkAction>(this.tw(sessionId, jobId, `/workers/${encodeURIComponent(worker)}`), {
      method: 'DELETE',
    })
  }

  // ---- config / providers ---------------------------------------------------
  getConfig() {
    return this.request<ConfigSnapshot>('/config')
  }

  patchConfig(patch: Partial<ConfigSnapshot>) {
    return this.request<ConfigSnapshot>('/config', { method: 'PATCH', body: JSON.stringify(patch) })
  }

  listProviders() {
    return this.request<{ providers: ProviderEntry[]; current_model: string }>('/providers')
  }

  createProvider(body: {
    api_style?: string
    name?: string
    base?: string
    key?: string
    proxy?: string
    model?: string
  }) {
    return this.request<ProviderEntry>('/providers', { method: 'POST', body: JSON.stringify(body) })
  }

  deleteProvider(name: string) {
    return this.request<{ removed: string }>(`/providers/${encodeURIComponent(name)}`, { method: 'DELETE' })
  }

  selectProvider(name: string, model?: string) {
    return this.request<{ current_provider: string; current_model: string }>(
      `/providers/${encodeURIComponent(name)}/select`,
      { method: 'POST', body: JSON.stringify({ model }) },
    )
  }

  providerModels(name: string) {
    return this.request<{ provider: string; models: string[] }>(
      `/providers/${encodeURIComponent(name)}/models`,
    )
  }

  // ---- files -----------------------------------------------------------------
  // Read-only listing rooted at the session's working directory, for the
  // composer's @-mentions and its attachment picker. Paths come back relative to
  // that root, which is the form a prompt can carry.
  listFiles(path = '') {
    const q = path ? `?path=${encodeURIComponent(path)}` : ''
    return this.request<FileListing>(`/files${q}`)
  }

  /** One workspace file's content (read-only, capped, UTF-8 sanitised). */
  fileContent(path: string, max?: number) {
    const q = new URLSearchParams({ path })
    if (max) q.set('max', String(max))
    return this.request<FileContent>(`/files/content?${q.toString()}`)
  }

  /** Tail of the runtime log, for the diagnostics pane. */
  logs(tail = 200) {
    return this.request<LogTail>(`/logs?tail=${tail}`)
  }

  // ---- skills ----------------------------------------------------------------
  // Inventory + body read are read-only file I/O; loadSkill mirrors the CLI's
  // /skill command (the body joins the session's leading system block). There
  // is no install/uninstall/enable API: skills are .md files under
  // .cell/skills/, discovered on every scan.
  skills() {
    return this.request<{ skills: { name: string; description: string; file: string }[] }>('/skills')
  }

  /** One skill's full body, front matter stripped. 404 unknown. */
  skillContent(name: string) {
    return this.request<SkillDetail>(`/skills/${encodeURIComponent(name)}`)
  }

  /** Load a skill into a session (409 while a turn runs, 404 unknown). */
  loadSkill(sessionId: string, name: string) {
    return this.request<SkillLoadResult>(
      `/sessions/${encodeURIComponent(sessionId)}/skills/${encodeURIComponent(name)}`,
      { method: 'POST' },
    )
  }

  // ---- misc -----------------------------------------------------------------

  usages() {
    return this.request<{ sessions?: Record<string, UsageRecord>; models?: Record<string, UsageRecord> }>(
      '/usages',
    )
  }

  notices(session?: string) {
    const q = session ? `?session=${encodeURIComponent(session)}` : ''
    return this.request<{ pending: { id: string; body: string; topic: string; from: string }[] }>(
      `/notices${q}`,
    )
  }

  postNotice(body: string, topic = '', session?: string) {
    return this.request<{ id: string }>('/notices', {
      method: 'POST',
      body: JSON.stringify({ body, topic, session }),
    })
  }
}

export const api = new ApiClient()
