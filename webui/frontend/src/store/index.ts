// Application state: one reactive store, no external state library (keeps the
// bundle small and works identically under Vapor and the standard runtime).

import { reactive } from 'vue'
import { api } from '../lib/api'
import { classifyError } from '../lib/errors'
import { createEventBus } from '../lib/events'
import { createFrameScheduler } from '../lib/scheduler'
import { sortByRecency } from '../lib/sessions'
import { usageTotals, type UsageTotals } from '../lib/stats'
import { applyTheme, resolveTheme, saveTheme, type ThemeName } from '../lib/theme'
import { normalizeTranscript, type UiMessage } from '../lib/transcript'
import type {
  Approval,
  Bootstrap,
  ConfigSnapshot,
  FileEntry,
  ProviderEntry,
  SessionSummary,
} from '../lib/api'

export type Phase = 'booting' | 'landing' | 'onboarding' | 'app'
/** Which of the two main views the shell shows (the reference GUI's 对话 / 轨迹 switch). */
export type ViewName = 'chat' | 'trace'

// Transcript normalisation lives in lib/transcript.ts (pure, unit tested); the
// types are re-exported here so components keep one import site.
export type { UiMessage, UiToolCall } from '../lib/transcript'

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
  paletteOpen: boolean
  toasts: Toast[]
  /** Usage counters: the whole install, and the session on screen. */
  usage: { all: UsageTotals; session: UsageTotals } | null
  lastInterrupted: boolean
  // ---- shell chrome ----
  theme: ThemeName
  view: ViewName
  /** Applied sidebar filter (the input debounces before writing it). */
  sessionQuery: string
  sidebarWidth: number
  sidebarCollapsed: boolean
  /** Optional right-hand panel (file/diff preview), off by default. */
  rightbarOpen: boolean
  rightbarWidth: number
  settingsOpen: boolean
  /** Teamwork footprint of the session on screen (the header's agent chip). */
  jobs: { count: number; workers: number }
  // ---- composer ----
  /** Messages typed while a turn was running; sent one by one when it ends. */
  queued: string[]
  /** Path references attached to the next message. */
  attachments: string[]
  /** Working-directory listing for the @-mention palette and the attach picker. */
  files: FileEntry[]
  filePath: string
  /** Skills available for /skill and @-mentions. */
  skills: { name: string; description: string }[]
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
  paletteOpen: false,
  toasts: [],
  usage: null,
  lastInterrupted: false,
  theme: resolveTheme(),
  view: 'chat',
  sessionQuery: '',
  sidebarWidth: 280,
  sidebarCollapsed: false,
  rightbarOpen: false,
  rightbarWidth: 420,
  settingsOpen: false,
  jobs: { count: 0, workers: 0 },
  queued: [],
  attachments: [],
  files: [],
  filePath: '',
  skills: [],
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


// ---- actions ------------------------------------------------------------------
export async function boot(): Promise<void> {
  applyTheme(state.theme)
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
    await Promise.all([refreshConfig(), refreshSessions(), refreshSkills(), refreshFiles()])
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
    // the sidebar is ordered by recency, and the kernel is the only source of
    // `updated_at` — sorting here keeps every consumer (rows, groups) in step
    state.sessions = sortByRecency(sessions)
    if (!state.currentSession && current) state.currentSession = current
  } catch (e) {
    toast('warn', `session list failed: ${String(e)}`)
  }
}

// ---- shell chrome ------------------------------------------------------------
export function setView(v: ViewName): void {
  state.view = v
}

export function setTheme(t: ThemeName): void {
  state.theme = t
  saveTheme(t)
  applyTheme(t)
}

export function toggleTheme(): void {
  setTheme(state.theme === 'dark' ? 'light' : 'dark')
}

export function setSessionQuery(q: string): void {
  state.sessionQuery = q
}

export function setSidebarWidth(w: number): void {
  state.sidebarWidth = w
}

export function setRightbarWidth(w: number): void {
  state.rightbarWidth = w
}

export function toggleRightbar(v?: boolean): void {
  state.rightbarOpen = v ?? !state.rightbarOpen
}

export function openSettings(v: boolean): void {
  state.settingsOpen = v
}

/** Re-read the transcript of the session on screen (after a turn, or on demand). */
export async function reloadMessages(): Promise<void> {
  const id = state.currentSession
  if (!id) return
  const { messages } = await api.sessionMessages(id).catch(() => ({ messages: [] }))
  state.messages = normalizeTranscript(messages)
}

/**
 * Teamwork footprint of the session on screen. The header shows it as a chip, so
 * it is refreshed with the session rather than polled: a job can only be created
 * through this same UI or the CLI, and the CLI's jobs land in the same store.
 */
export async function refreshJobs(): Promise<void> {
  const id = state.currentSession
  if (!id) {
    state.jobs = { count: 0, workers: 0 }
    return
  }
  try {
    const list = await api.getSessionTeamworks(id)
    state.jobs = {
      count: list.jobs.length,
      workers: list.jobs.reduce((n, j) => n + (j.workers?.length ?? 0), 0),
    }
  } catch {
    state.jobs = { count: 0, workers: 0 }
  }
}

// ---- composer ----------------------------------------------------------------
// The queue is deliberately one turn deep in behaviour: cell runs one turn at a
// time (a second POST is a 409), so anything typed while a turn is running waits
// and is sent when it ends, in order.

export function attach(path: string): void {
  const p = path.trim()
  if (p && !state.attachments.includes(p)) state.attachments.push(p)
}

export function detach(path: string): void {
  state.attachments = state.attachments.filter((p) => p !== path)
}

export function clearAttachments(): void {
  state.attachments = []
}

/** Send now, or queue when a turn is already running. Returns true when queued. */
export function submitOrQueue(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (state.streaming) {
    state.queued.push(t)
    return true
  }
  void send(t)
  return false
}

export function dropQueued(index: number): void {
  state.queued.splice(index, 1)
}

export function clearQueued(): void {
  state.queued = []
}

/** Start the next queued message; called when a turn finishes. */
export function drainQueue(): void {
  if (state.streaming) return
  const next = state.queued.shift()
  if (next) void send(next)
}

export async function refreshFiles(path = ''): Promise<void> {
  try {
    const listing = await api.listFiles(path)
    state.files = listing.entries
    state.filePath = listing.path === '.' ? '' : listing.path
  } catch {
    state.files = []
  }
}

export async function refreshSkills(): Promise<void> {
  try {
    const { skills } = await api.skills()
    state.skills = skills.map((s) => ({ name: s.name, description: s.description }))
  } catch {
    state.skills = []
  }
}

export async function setModel(provider: string, model?: string): Promise<void> {
  try {
    const r = await api.selectProvider(provider, model)
    if (state.config) {
      state.config.current_provider = r.current_provider
      state.config.current_model = r.current_model
    }
    toast('ok', `模型：${r.current_provider}:${r.current_model}`)
  } catch (e) {
    toast('bad', `切换模型失败：${String(e)}`)
  }
}

export async function setThink(level: number): Promise<void> {
  try {
    state.config = await api.patchConfig({ think_level: level })
  } catch (e) {
    toast('bad', `调整思考深度失败：${String(e)}`)
  }
}

/** Permission fence: the sandbox mode plus its auto-allow flag, always together. */
export async function setFence(mode: string, autoallow: boolean): Promise<void> {
  try {
    state.config = await api.patchConfig({ sandbox_mode: mode, autoallow } as Partial<ConfigSnapshot>)
  } catch (e) {
    toast('bad', `切换权限失败：${String(e)}`)
  }
}

export async function setTools(on: boolean): Promise<void> {
  try {
    state.config = await api.patchConfig({ tools: on } as Partial<ConfigSnapshot>)
  } catch (e) {
    toast('bad', `切换工具失败：${String(e)}`)
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
    void refreshUsage()
    void refreshJobs()
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
    // the row label and its age come from the kernel, so the sidebar only
    // becomes accurate after the turn has landed
    void refreshSessions()
    drainQueue()
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
    void refreshSessions()
    drainQueue()
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
    const u = await api.usages()
    // The strip shows both scopes: the install total (what this thing has cost
    // overall) and the session on screen. Records for deleted sessions are
    // pruned server-side, so no filtering is needed here.
    const sid = state.currentSession
    const record = sid ? u.sessions?.[sid] : undefined
    state.usage = {
      all: usageTotals(u.models),
      session: usageTotals(record ? { [sid as string]: record } : undefined),
    }
  } catch {
    /* usage is informational */
  }
}

export function openPalette(v: boolean): void {
  state.paletteOpen = v
}

export function toggleSidebar(): void {
  state.sidebarCollapsed = !state.sidebarCollapsed
}
