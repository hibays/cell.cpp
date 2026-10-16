// Application state: one reactive store, no external state library (keeps the
// bundle small and works identically under Vapor and the standard runtime).

import { reactive } from 'vue'
import { api } from '../lib/api'
import { classifyError } from '../lib/errors'
import { createEventBus } from '../lib/events'
import { applyEvent, emptyLiveTurn, type LiveTurn } from '../lib/liveTurn'
import { createFrameScheduler } from '../lib/scheduler'
import { sortByRecency } from '../lib/sessions'
import { usageTotals, type UsageTotals } from '../lib/stats'
import { applyTheme, resolveTheme, saveTheme, type ThemeName } from '../lib/theme'
import { normalizeTranscript, type UiMessage } from '../lib/transcript'
import type {
  Approval,
  Bootstrap,
  ConfigSnapshot,
  FileContent,
  FileEntry,
  ProviderEntry,
  SessionSummary,
  TeamworkJob,
  TeamworkReport,
  TurnEvent,
} from '../lib/api'

export type Phase = 'booting' | 'landing' | 'onboarding' | 'app'
/** Which of the two main views the shell shows (the reference GUI's 对话 / 轨迹 switch). */
export type ViewName = 'chat' | 'trace'
/** The right-hand panel's tabs. */
export type SideTab = 'files' | 'changes' | 'logs'

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
  /** The turn in flight, folded from the kernel's semantic events. */
  live: LiveTurn | null
  /** The sidebar is showing archived sessions instead of the live ones. */
  showArchived: boolean
  /** What has been uploaded into the workspace's .cell-uploads/ so far. */
  uploads: { name: string; path: string; size: number }[]
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
  // ---- right-hand panel ----
  sideTab: SideTab
  /** The file open in the viewer; null shows the browser instead. */
  openFile: FileContent | null
  /** Tail of the runtime log for the diagnostics tab. */
  logLines: string[]
  logsTruncated: boolean
  /** The session's teamwork jobs (the header's chip counts their children). */
  jobs: TeamworkJob[]
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
  /** A child agent's report, loaded on demand from the trace view. */
  workerReport: TeamworkReport | null
  workerReportError: string
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
  live: null,
  showArchived: false,
  uploads: [],
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
  sideTab: 'files',
  openFile: null,
  logLines: [],
  logsTruncated: false,
  jobs: [],
  queued: [],
  attachments: [],
  files: [],
  filePath: '',
  skills: [],
  workerReport: null,
  workerReportError: '',
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
    await Promise.all([refreshConfig(), refreshSessions(), refreshSkills(), refreshFiles(), refreshUploads()])
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

// ---- archives ---------------------------------------------------------------
// Archiving hides a session from the default list; it keeps its transcript and
// its id, so a link to it still opens. The sidebar switches between the two
// lists rather than mixing them.

export function toggleArchived(): void {
  state.showArchived = !state.showArchived
  void refreshSessions()
}

export async function setArchived(sid: string, archived: boolean): Promise<void> {
  try {
    if (archived) await api.archiveSession(sid)
    else await api.unarchiveSession(sid)
    if (state.currentSession === sid && archived && !state.showArchived) {
      // the session on screen just left the list; keep showing it rather than
      // stranding the user on an empty view
      state.showArchived = true
    }
    toast('ok', archived ? '已归档（记录仍保留，可恢复）' : '已恢复到活跃列表')
    await refreshSessions()
  } catch (e) {
    toast('bad', `${archived ? '归档' : '恢复'}失败：${String(e)}`)
  }
}

// ---- uploads ----------------------------------------------------------------
// An upload is "put these bytes where the agent can read them": the kernel
// parks them under the workspace's .cell-uploads/ and returns the path, which
// the composer then attaches like any other reference.

export async function refreshUploads(): Promise<void> {
  try {
    state.uploads = (await api.listUploads()).entries
  } catch {
    state.uploads = []
  }
}

export async function uploadFiles(files: File[] | FileList): Promise<void> {
  const list = [...files]
  if (!list.length) return
  let ok = 0
  for (const f of list) {
    try {
      const buf = await f.arrayBuffer()
      const r = await api.upload(f.name, buf)
      attach(r.path)
      ok++
    } catch (e) {
      toast('bad', `${f.name} 上传失败：${String(e)}`)
    }
  }
  if (ok) {
    toast('ok', `已上传 ${ok} 个文件到工作区的 .cell-uploads/（已作为参考文件附加）`)
    void refreshUploads()
  }
}

// ---- right-hand panel ---------------------------------------------------------
export function setSideTab(tab: SideTab): void {
  state.sideTab = tab
}

/** Open a workspace file in the viewer. A failure clears it and says why. */
export async function openFileAt(path: string): Promise<void> {
  try {
    state.openFile = await api.fileContent(path)
    state.rightbarOpen = true
    state.sideTab = 'files'
  } catch (e) {
    state.openFile = null
    toast('warn', `无法打开 ${path}：${String(e)}`)
  }
}

export function closeFile(): void {
  state.openFile = null
}

export async function refreshLogs(tail = 300): Promise<void> {
  try {
    const out = await api.logs(tail)
    state.logLines = out.lines
    state.logsTruncated = out.truncated
  } catch (e) {
    toast('warn', `读取日志失败：${String(e)}`)
  }
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
    state.jobs = []
    return
  }
  try {
    state.jobs = (await api.getSessionTeamworks(id)).jobs
  } catch {
    state.jobs = []
  }
}

/** Load one job's per-worker report (counters plus, on request, transcripts). */
export async function loadWorkerReport(jobId: string, transcript = true): Promise<void> {
  const id = state.currentSession
  if (!id) return
  state.workerReportError = ''
  try {
    state.workerReport = await api.teamworkReport(id, jobId, transcript)
  } catch (e) {
    state.workerReport = null
    state.workerReportError = String(e)
  }
}

/**
 * Clear the session's context — the REST twin of the CLI's /clear. The
 * transcript goes, the recorded reads go, and its teamwork store with them; the
 * kernel refuses while a turn or a background job is running, and so do we.
 */
export async function clearCurrentSession(): Promise<boolean> {
  const id = state.currentSession
  if (!id) return false
  if (state.streaming) {
    toast('warn', '这一轮还在跑，结束后再清空')
    return false
  }
  try {
    const r = await api.clearSession(id)
    state.messages = []
    state.lastInterrupted = false
    state.jobs = []
    void refreshUsage()
    void refreshJobs()
    toast('ok', `已清空会话（移除 ${r.removed} 条消息${r.jobs ? `，${r.jobs} 个协作任务` : ''}）`)
    return true
  } catch (e) {
    toast('bad', `清空失败：${String(e)}`)
    return false
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

// A turn can emit hundreds of deltas per second; folding each straight into
// reactive state means a render per token and a page that stops taking input.
// The high-frequency events (text and reasoning deltas, accounting) are queued
// and applied at most once per frame; everything structural — a tool starting or
// finishing, an interrupt — applies immediately, because those are the moments
// the user is watching for.
let pending: TurnEvent[] = []
const publishStream = createFrameScheduler(
  () => {
    if (!state.live) {
      pending = []
      return
    }
    for (const e of pending) applyEvent(state.live, e)
    pending = []
  },
  {
    raf: (cb) => window.requestAnimationFrame(cb),
    cancel: (h) => window.cancelAnimationFrame(h),
  },
)

// Turn events are routed through a callback registry rather than one inline
// switch, so a new kernel event is a new subscription instead of a new branch.
const events = createEventBus()

events.on('approval_request', (e) => onApproval(e.data))

events.on('error', (e) => {
  // route on code, never on provider-dependent message text
  const v = classifyError(e.data)
  toast(v.retryable ? 'warn' : 'bad', v.title)
})

events.on('turn_start', (e) => {
  state.streamModel = e.data.model
})

// A notice posted for the running session reaches us as an event — no polling.
events.on('notice', (e) => {
  const { topic, body } = e.data
  toast('info', topic ? `${topic}：${body}` : body)
})

const BATCHED = new Set(['token', 'reasoning', 'usage', 'output'])
events.onAny((e) => {
  if (!state.live) return
  if (BATCHED.has(e.type)) {
    pending.push(e)
    publishStream.request()
    return
  }
  applyEvent(state.live, e)
})

/** Begin a turn: a fresh live turn is what every later event folds into. */
function beginStream(): void {
  state.live = emptyLiveTurn()
  pending = []
  state.streaming = true
  state.streamStartedAt = Date.now()
  state.lastInterrupted = false
}

/** End a turn: drop any unpublished buffer, it is superseded by the transcript. */
function endStream(): void {
  publishStream.cancel()
  pending = []
}

export async function send(text: string): Promise<void> {
  const id = state.currentSession
  if (!id || !text.trim() || state.streaming) return
  state.messages.push({ key: `m${msgSeq++}`, role: 'user', text })
  beginStream()
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
    state.live = null
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
  beginStream()
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
    state.live = null
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
      // `sid &&` narrows the id to a string, which is what the map key wants
      session: usageTotals(sid && record ? { [sid]: record } : undefined),
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
