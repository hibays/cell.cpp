// Application state: one reactive store, no external state library (keeps the
// bundle small and works identically under Vapor and the standard runtime).

import { reactive } from 'vue'
import { api } from '../lib/api'
import { classifyError } from '../lib/errors'
import { createEventBus } from '../lib/events'
import { createFrameScheduler } from '../lib/scheduler'
import type {
  Approval,
  Bootstrap,
  ConfigSnapshot,
  ProviderEntry,
  SessionSummary,
} from '../lib/api'

export type Phase = 'booting' | 'landing' | 'onboarding' | 'app'

export interface UiToolCall {
  id: string
  name: string
  args: string
  status: 'running' | 'ok' | 'blocked' | 'denied'
  output: string
  seconds?: number
}

export interface UiMessage {
  key: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  text: string
  reasoning?: string
  tools?: UiToolCall[]
  ts?: number
}

export interface Toast {
  id: number
  kind: 'info' | 'ok' | 'warn' | 'bad'
  text: string
}

interface State {
  phase: Phase
  bootstrap: Bootstrap | null
  bootError: string
  sessions: SessionSummary[]
  currentSession: string | null
  messages: UiMessage[]
  loadingMessages: boolean
  streaming: boolean
  streamText: string
  streamStartedAt: number
  streamModel: string
  approvals: Approval[]
  config: ConfigSnapshot | null
  providers: ProviderEntry[]
  sidebarOpen: boolean
  paletteOpen: boolean
  toasts: Toast[]
  usage: { tok_in: number; tok_out: number; requests: number } | null
  lastInterrupted: boolean
}

const state = reactive<State>({
  phase: 'booting',
  bootstrap: null,
  bootError: '',
  sessions: [],
  currentSession: null,
  messages: [],
  loadingMessages: false,
  streaming: false,
  streamText: '',
  streamStartedAt: 0,
  streamModel: '',
  approvals: [],
  config: null,
  providers: [],
  sidebarOpen: true,
  paletteOpen: false,
  toasts: [],
  usage: null,
  lastInterrupted: false,
})

let toastSeq = 1
let msgSeq = 1

// exported directly (not readonly): every mutation goes through the actions
// defined further down in this module
export const store = state

// ---- toasts ------------------------------------------------------------------
export function toast(kind: Toast['kind'], text: string): void {
  const id = toastSeq++
  state.toasts.push({ id, kind, text })
  setTimeout(() => {
    const i = state.toasts.findIndex((t) => t.id === id)
    if (i >= 0) state.toasts.splice(i, 1)
  }, 4200)
}

// ---- transcript normalisation -------------------------------------------------
// The service returns the raw transcript (OpenAI/Anthropic shapes). The UI needs
// flat items: text, reasoning and tool calls with their results attached.

type Json = Record<string, unknown>

function asRecord(v: unknown): Json {
  return typeof v === 'object' && v !== null ? (v as Json) : {}
}

function pickString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

export function normalizeTranscript(raw: unknown[]): UiMessage[] {
  const out: UiMessage[] = []
  const toolIndex = new Map<string, UiToolCall>()

  for (const entry of raw) {
    const m = asRecord(entry)
    const role = typeof m.role === 'string' ? m.role : 'system'
    const content = m.content
    const reasoningText = pickString(m.reasoning_content) ?? pickString(m.reasoning)
    const toolCalls = Array.isArray(m.tool_calls) ? m.tool_calls : []

    if (role === 'tool') {
      // tool result: attach to the matching call of the previous assistant msg
      const text = typeof content === 'string' ? content : JSON.stringify(content ?? '')
      const last = out.findLast((x) => (x.tools?.length ?? 0) > 0)
      const target = last?.tools?.find((t) => t.status === 'running')
      if (target) {
        target.status = 'ok'
        target.output = text
      }
      continue
    }

    if (role === 'assistant') {
      const text = contentToText(content)
      const reasoning = reasoningText
      const tools: UiToolCall[] = []
      for (const tc of toolCalls) {
        const call = asRecord(tc)
        const fn = asRecord(call.function)
        const name = pickString(fn.name) ?? '?'
        const args = pickString(fn.arguments) ?? ''
        const card: UiToolCall = { id: pickString(call.id) ?? name, name, args, status: 'ok', output: '' }
        tools.push(card)
        toolIndex.set(card.id, card)
      }
      if (!text && !reasoning && tools.length === 0) continue
      out.push({
        key: `m${msgSeq++}`,
        role: 'assistant',
        text,
        reasoning,
        tools: tools.length ? tools : undefined,
        ts: typeof m.ts === 'number' ? m.ts : undefined,
      })
      continue
    }

    if (role === 'user') {
      const text = contentToText(content)
      if (!text.trim()) continue
      out.push({ key: `m${msgSeq++}`, role: 'user', text, ts: typeof m.ts === 'number' ? m.ts : undefined })
      continue
    }

    // system notes are folded into the leading block by the agent; keep the UI quiet
    if (role === 'system') continue
  }
  return out
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        const block = b as { type?: string; text?: string; content?: unknown }
        if (block.type === 'text' && typeof block.text === 'string') return block.text
        if (typeof block.content === 'string') return block.content
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

// ---- actions ------------------------------------------------------------------
export async function boot(): Promise<void> {
  try {
    state.bootstrap = await api.bootstrap()
    if (!state.bootstrap.serve_ok) {
      state.bootError = state.bootstrap.serve_error || 'the agent service is not running'
      state.phase = 'landing'
      toast('bad', `agent service: ${state.bootError}`)
      return
    }
    api.base = state.bootstrap.api?.base ?? ''
    api.token = state.bootstrap.api?.token ?? ''
    await Promise.all([refreshConfig(), refreshSessions()])
    // the landing page is the first thing the user sees; enterApp() moves on
    state.phase = 'landing'
  } catch (e) {
    state.bootError = String(e)
    state.phase = 'landing'
  }
}

/** Landing → workspace (onboarding first when no provider is registered). */
export function enterApp(): void {
  state.phase = state.providers.length === 0 ? 'onboarding' : 'app'
}

export async function refreshConfig(): Promise<void> {
  try {
    state.config = await api.getConfig()
    const list = await api.listProviders()
    state.providers = list.providers
  } catch {
    /* config may be unavailable before a provider exists */
  }
}

export async function refreshSessions(): Promise<void> {
  try {
    const { sessions, current } = await api.listSessions()
    state.sessions = sessions
    if (!state.currentSession && current) state.currentSession = current
  } catch (e) {
    toast('warn', `session list failed: ${String(e)}`)
  }
}

export async function selectSession(id: string): Promise<void> {
  state.currentSession = id
  state.loadingMessages = true
  try {
    const { messages } = await api.sessionMessages(id)
    state.messages = normalizeTranscript(messages)
  } catch (e) {
    state.messages = []
    if (String(e).includes('404')) {
      // a brand-new session has no transcript yet
      state.messages = []
    }
  } finally {
    state.loadingMessages = false
  }
}

export async function newSession(): Promise<string | null> {
  try {
    const { id } = await api.createSession()
    state.currentSession = id
    state.messages = []
    await refreshSessions()
    toast('ok', `new session ${id.slice(-6)}`)
    return id
  } catch (e) {
    toast('bad', `cannot create session: ${String(e)}`)
    return null
  }
}

export async function deleteSession(id: string): Promise<void> {
  try {
    await api.deleteSession(id)
    if (state.currentSession === id) {
      state.currentSession = null
      state.messages = []
    }
    await refreshSessions()
    toast('ok', 'session deleted')
  } catch (e) {
    toast('bad', `delete failed: ${String(e)}`)
  }
}

// A turn can emit hundreds of deltas per second; assigning each straight into
// reactive state means a render per token and a page that stops taking input.
// Deltas are buffered and published at most once per frame window instead.
let streamBuffer = ''
const publishStream = createFrameScheduler(
  () => {
    if (!streamBuffer) return
    state.streamText += streamBuffer
    streamBuffer = ''
  },
  {
    raf: (cb) => window.requestAnimationFrame(cb),
    cancel: (h) => window.cancelAnimationFrame(h),
  },
)

// Turn events are routed through a callback registry rather than one inline
// switch, so a new kernel event is a new subscription instead of a new branch.
const events = createEventBus()

events.on('output', (e) => {
  streamBuffer += e.data.text
  publishStream.request()
})

events.on('approval_request', (e) => onApproval(e.data))

events.on('error', (e) => {
  // route on code, never on provider-dependent message text
  const v = classifyError(e.data)
  toast(v.retryable ? 'warn' : 'bad', v.title)
})

events.on('turn_start', (e) => {
  state.streamModel = e.data.model
})

/** End a turn: drop any unpublished buffer, it is superseded by the transcript. */
function endStream(): void {
  publishStream.cancel()
  streamBuffer = ''
}

export async function send(text: string): Promise<void> {
  const id = state.currentSession
  if (!id || !text.trim() || state.streaming) return
  state.messages.push({ key: `m${msgSeq++}`, role: 'user', text })
  state.streaming = true
  state.streamText = ''
  state.streamStartedAt = Date.now()
  state.lastInterrupted = false
  try {
    await api.streamTurn(id, text, (e) => events.emitRaw(e))
  } catch (e) {
    const v = classifyError(e)
    if (v.code === 'aborted') {
      state.lastInterrupted = true
    } else {
      toast(v.retryable ? 'warn' : 'bad', `${v.title} — ${v.hint}`)
    }
  } finally {
    // the streamed text is already persisted server-side: reload the transcript
    // so tool calls, reasoning and usage all show up in their structured form
    endStream()
    const { messages } = await api.sessionMessages(id).catch(() => ({ messages: [] }))
    state.messages = normalizeTranscript(messages)
    state.streaming = false
    state.streamText = ''
    state.approvals = []
    void refreshUsage()
  }
}

export async function interrupt(): Promise<void> {
  if (!state.currentSession || !state.streaming) return
  try {
    await api.interrupt(state.currentSession)
    state.lastInterrupted = true
  } catch (e) {
    toast('warn', `interrupt failed: ${String(e)}`)
  }
}

export async function resume(): Promise<void> {
  const id = state.currentSession
  if (!id || state.streaming) return
  state.streaming = true
  state.streamText = ''
  state.streamStartedAt = Date.now()
  state.lastInterrupted = false
  try {
    await api.streamResume(id, (e) => events.emitRaw(e))
  } catch (e) {
    const v = classifyError(e)
    toast(v.retryable ? 'warn' : 'bad', `${v.title} — ${v.hint}`)
  } finally {
    endStream()
    const { messages } = await api.sessionMessages(id).catch(() => ({ messages: [] }))
    state.messages = normalizeTranscript(messages)
    state.streaming = false
    state.streamText = ''
    state.approvals = []
    void refreshUsage()
  }
}

function onApproval(a: Approval): void {
  state.approvals.push(a)
}

export async function approve(id: string): Promise<void> {
  try {
    await api.decideApproval(id, 'allow')
    state.approvals = state.approvals.filter((a) => a.request_id !== id)
  } catch (e) {
    toast('bad', `approval failed: ${String(e)}`)
  }
}

export async function deny(id: string, reason = 'rejected in the UI'): Promise<void> {
  try {
    await api.decideApproval(id, 'deny', reason)
    state.approvals = state.approvals.filter((a) => a.request_id !== id)
  } catch (e) {
    toast('bad', `rejection failed: ${String(e)}`)
  }
}

export async function refreshUsage(): Promise<void> {
  try {
    const u = (await api.usages()) as {
      models?: Record<string, { input_tokens?: number; output_tokens?: number; requests?: number }>
    }
    let tok_in = 0
    let tok_out = 0
    let requests = 0
    for (const v of Object.values(u.models ?? {})) {
      tok_in += v.input_tokens ?? 0
      tok_out += v.output_tokens ?? 0
      requests += v.requests ?? 0
    }
    state.usage = { tok_in, tok_out, requests }
  } catch {
    /* usage is informational */
  }
}

export function openPalette(v: boolean): void {
  state.paletteOpen = v
}

export function toggleSidebar(): void {
  state.sidebarOpen = !state.sidebarOpen
}
