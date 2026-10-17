// Trace derivation: the transcript folded into per-turn steps.
//
// The 轨迹 tab answers "what did it actually do", so it needs the turn
// boundaries and, inside each turn, the ordered list of things the agent did:
// reasoning, tool calls (with status and duration), and the answer. All of it
// is derived from the normalised transcript, which means the tab works on
// historical sessions too — not just the turn that is running.

import type { UiMessage, UiToolCall } from './transcript'

export type TraceStepKind = 'reasoning' | 'tool' | 'answer'

export interface TraceStep {
  key: string
  kind: TraceStepKind
  /** Tool name for `tool` steps. */
  name?: string
  /** Tool arguments as the model sent them (raw string). */
  args?: string
  status?: UiToolCall['status']
  seconds?: number
  /** Tool output, already normalised. */
  output?: string
  /** Transcript timestamp of the message this step came from, Unix seconds. */
  ts?: number
  /** Reasoning or answer text. */
  text?: string
  /** An answer step whose record carried nothing — shown as an explicit gap. */
  empty?: boolean
}

export interface TraceTurn {
  /** 1-based turn number, as displayed. */
  index: number
  key: string
  /** The user message that opened the turn. */
  prompt: string
  ts?: number
  steps: TraceStep[]
  /** Tool calls in this turn (count only, for the summary chip). */
  toolCount: number
}

/** Fold a transcript into turns. Assistant messages without tools still close the turn. */
export function buildTurns(messages: UiMessage[]): TraceTurn[] {
  const turns: TraceTurn[] = []
  let current: TraceTurn | null = null

  const open = (m: UiMessage): TraceTurn => {
    const t: TraceTurn = {
      index: turns.length + 1,
      key: `t${turns.length + 1}-${m.key}`,
      prompt: m.text,
      ts: m.ts,
      steps: [],
      toolCount: 0,
    }
    turns.push(t)
    return t
  }

  for (const m of messages) {
    if (m.role === 'user') {
      current = open(m)
      continue
    }
    if (m.role !== 'assistant') continue
    // an assistant message with no user turn before it (a resumed session can
    // start mid-turn) still deserves a row rather than being dropped
    if (!current) current = open({ ...m, text: '', role: 'user' })

    let idx = 0
    if (m.reasoning && m.reasoning.trim()) {
      current.steps.push({
        key: `${current.key}-r${idx++}`,
        kind: 'reasoning',
        text: m.reasoning,
        ts: m.ts,
      })
    }
    for (const tool of m.tools ?? []) {
      current.steps.push({
        key: `${current.key}-t${idx++}`,
        kind: 'tool',
        name: tool.name,
        args: tool.args,
        status: tool.status,
        seconds: tool.seconds,
        output: tool.output,
      })
      current.toolCount++
    }
    if (m.text && m.text.trim()) {
      current.steps.push({ key: `${current.key}-a${idx++}`, kind: 'answer', text: m.text, ts: m.ts })
    } else if (m.empty) {
      // the turn "finished" with nothing in it: an explicit step beats a turn
      // that looks like it never answered
      current.steps.push({ key: `${current.key}-a${idx++}`, kind: 'answer', text: '', empty: true, ts: m.ts })
    }
  }
  return turns
}

/** A coarse status for the turn's summary chip: the worst thing that happened. */
export function turnStatus(t: TraceTurn): 'running' | 'blocked' | 'ok' {
  if (t.steps.some((s) => s.kind === 'tool' && s.status === 'running')) return 'running'
  if (t.steps.some((s) => s.kind === 'tool' && (s.status === 'blocked' || s.status === 'denied')))
    return 'blocked'
  return 'ok'
}
