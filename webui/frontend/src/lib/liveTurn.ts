// The turn that is currently running, folded from semantic events.
//
// Before this existed the shell had one string of captured stdout and had to
// re-fetch the whole transcript when the turn ended to learn what had happened
// (which tool ran, whether it was blocked, what it cost). The kernel now emits
// the structure as it goes, so the reducer below is the only place that knows
// how to turn those events into a renderable turn — and because it is pure, it
// is testable without a kernel, a DOM or a clock.

import type { TurnEvent, UsageEvent } from './api'
import type { UiToolCall } from './transcript'

export type ToolStatus = UiToolCall['status']

export interface LiveUsage {
  /** Requests in this turn (a turn can be several: one per tool round). */
  requests: number
  inTokens: number
  outTokens: number
  totalTokens: number
  cachedTokens: number
  promptTokens: number
  /** Wall time of the requests themselves, and of the decode windows inside them. */
  requestMs: number
  decodeMs: number
  /** Last-wins context occupancy (not summed): the newest request is the truth. */
  contextWindow?: number
  contextTokens?: number
  contextPct?: number
}

export interface LiveTurn {
  text: string
  reasoning: string
  tools: UiToolCall[]
  usage: LiveUsage | null
  /** The kernel said the partial answer is final (a cancel), not still arriving. */
  interrupted: boolean
  /**
   * Raw captured stdout, kept only while no semantic text has arrived: a kernel
   * without the semantic events (or the moment before the first token) still
   * shows something instead of an empty bubble.
   */
  fallbackText: string
}

export function emptyLiveTurn(): LiveTurn {
  return { text: '', reasoning: '', tools: [], usage: null, interrupted: false, fallbackText: '' }
}

const EMPTY_USAGE: LiveUsage = {
  requests: 0,
  inTokens: 0,
  outTokens: 0,
  totalTokens: 0,
  cachedTokens: 0,
  promptTokens: 0,
  requestMs: 0,
  decodeMs: 0,
}

/** Kernel tool statuses → the four the UI renders. */
export function toolStatusOf(status: string): ToolStatus {
  if (status === 'ok') return 'ok'
  if (status === 'blocked') return 'blocked'
  return 'failed'
}

/** What the transcript should show for the running turn. */
export function liveText(live: LiveTurn): string {
  return live.text || live.fallbackText
}

/** Decode rate over the turn, or undefined when nothing was decoded. */
export function liveTokensPerSecond(live: LiveTurn): number | undefined {
  const u = live.usage
  if (!u || u.decodeMs <= 0 || u.outTokens <= 0) return undefined
  return u.outTokens / (u.decodeMs / 1000)
}

/** Cache-hit ratio over the turn, measured against the prompt total it reports. */
export function liveCacheHit(live: LiveTurn): number | undefined {
  const u = live.usage
  if (!u) return undefined
  const denom = u.promptTokens > 0 ? u.promptTokens : u.inTokens
  if (denom <= 0 || u.cachedTokens <= 0) return undefined
  return Math.min(1, u.cachedTokens / denom)
}

function accumulate(prev: LiveUsage | null, e: UsageEvent): LiveUsage {
  const base = prev ?? { ...EMPTY_USAGE }
  return {
    requests: base.requests + 1,
    inTokens: base.inTokens + e.in_tokens,
    outTokens: base.outTokens + e.out_tokens,
    totalTokens: base.totalTokens + e.total_tokens,
    cachedTokens: base.cachedTokens + e.cached_tokens,
    promptTokens: base.promptTokens + e.prompt_tokens,
    requestMs: base.requestMs + e.request_ms,
    decodeMs: base.decodeMs + e.decode_ms,
    // last-wins: the newest request describes the context as it stands now
    contextWindow: e.context_window ?? base.contextWindow,
    contextTokens: e.context_tokens ?? base.contextTokens,
    contextPct: e.context_pct ?? base.contextPct,
  }
}

/**
 * Apply one event to the live turn, in place.
 *
 * In place because the store holds exactly one of these and replaces it per
 * turn: copying a growing tool list on every token would be the allocation
 * storm the frame scheduler exists to avoid.
 */
export function applyEvent(live: LiveTurn, ev: TurnEvent): void {
  switch (ev.type) {
    case 'token':
      live.text += ev.data.text
      return
    case 'reasoning':
      live.reasoning += ev.data.text
      return
    case 'output':
      // only a fallback: the captured stdout duplicates the semantic stream
      if (!live.text) live.fallbackText += ev.data.text
      return
    case 'tool_call':
      live.tools.push({
        id: ev.data.id || `live-${live.tools.length + 1}`,
        name: ev.data.name,
        args: ev.data.args,
        status: 'running',
        output: '',
      })
      return
    case 'tool_result': {
      // by id — two calls to the same tool is the normal case, so matching on
      // the name would pair the wrong result
      const byId = live.tools.find((t) => t.id === ev.data.id)
      const target = byId ?? live.tools.find((t) => t.name === ev.data.name && t.status === 'running')
      if (!target) return
      target.status = toolStatusOf(ev.data.status)
      target.seconds = ev.data.seconds
      target.output = ev.data.output + (ev.data.truncated ? '\n…[流式输出已截断，完整内容见回合结束后的记录]' : '')
      return
    }
    case 'usage':
      live.usage = accumulate(live.usage, ev.data)
      return
    case 'interrupt':
      live.interrupted = true
      return
    default:
      return
  }
}

/** Fold a whole turn's worth of events (used by the tests, and by replay). */
export function foldEvents(events: TurnEvent[]): LiveTurn {
  const live = emptyLiveTurn()
  for (const e of events) applyEvent(live, e)
  return live
}
