// Telemetry derivations for the strip under the composer.
//
// Everything here is a pure function of data the kernel already sends, because
// the strip must never invent a number: the token counters come from
// `/v1/usages` (which now also carries the prompt-cache counters), while the
// turn/step counts are derived from the transcript itself.

import type { UsageRecord } from './api'
import type { UiMessage } from './transcript'

export interface TranscriptStats {
  /** User turns in this session. */
  turns: number
  /** Tool calls across those turns — the "步" of the reference GUI. */
  steps: number
}

export function transcriptStats(messages: UiMessage[]): TranscriptStats {
  let turns = 0
  let steps = 0
  for (const m of messages) {
    if (m.role === 'user') turns++
    if (m.tools?.length) steps += m.tools.length
  }
  return { turns, steps }
}

export interface UsageTotals {
  requests: number
  messages: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedTokens: number
  promptTokens: number
}

const EMPTY: UsageTotals = {
  requests: 0,
  messages: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedTokens: 0,
  promptTokens: 0,
}

/** Sum the counters of a set of usage records (a session's, or every model's). */
export function usageTotals(records: Record<string, UsageRecord> | undefined): UsageTotals {
  const out = { ...EMPTY }
  for (const r of Object.values(records ?? {})) {
    out.requests += r.requests ?? 0
    out.messages += r.messages ?? 0
    out.inputTokens += r.input_tokens ?? 0
    out.outputTokens += r.output_tokens ?? 0
    out.totalTokens += r.total_tokens ?? 0
    out.cachedTokens += r.cached_tokens ?? 0
    out.promptTokens += r.prompt_tokens ?? 0
  }
  return out
}

/**
 * Cache-hit ratio, or undefined when the provider never reported a prompt
 * total — a dash is honest, "0.0%" would not be.
 *
 * The denominator is `prompt_tokens` (what the kernel measured the cache
 * against), falling back to `input_tokens` for records written by an older
 * build, which did not carry the explicit prompt total.
 */
export function cacheHitRatio(t: UsageTotals): number | undefined {
  const denom = t.promptTokens > 0 ? t.promptTokens : t.inputTokens
  if (denom <= 0) return undefined
  return Math.min(1, t.cachedTokens / denom)
}
