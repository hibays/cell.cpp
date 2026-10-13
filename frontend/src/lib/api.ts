// Typed client for the in-process agent service (`cell --serve`, see
// docs/RESTful.md). One base URL + one bearer token, discovered at runtime
// through the native bridge (cell_bootstrap).

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
  snippet: string
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

export type TurnEvent =
  | { type: 'turn_start'; data: { session: string; model: string } }
  | { type: 'output'; data: { text: string } }
  | { type: 'approval_request'; data: Approval }
  | { type: 'turn_done'; data: { rc: number; interrupted: boolean } }
  | { type: 'error'; data: { code: string; message: string } }

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
    const raw = await window.cell.cell_bootstrap()
    return parseJson<Bootstrap>(raw)!
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

  // ---- misc -----------------------------------------------------------------
  skills() {
    return this.request<{ skills: { name: string; description: string; file: string }[] }>('/skills')
  }

  usages() {
    return this.request<Record<string, unknown>>('/usages')
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
