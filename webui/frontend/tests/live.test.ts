// Live-turn reducer tests.
//
// The reducer is the only place that knows how the kernel's semantic events fold
// into something renderable, so the rules it encodes get pinned here: pairing a
// tool result to its call by id (two calls to the same tool in one round is the
// normal case, not an edge case), the fallback to captured stdout only while no
// semantic text has arrived, and the honest "undefined" for a rate or a cache
// hit that cannot be computed.
//
// Run: bun test tests/
import { describe, expect, test } from 'bun:test'
import {
  applyEvent,
  emptyLiveTurn,
  foldEvents,
  liveCacheHit,
  liveText,
  liveTokensPerSecond,
  toolStatusOf,
} from '../src/lib/liveTurn'
import type { TurnEvent } from '../src/lib/api'

const token = (text: string): TurnEvent => ({ type: 'token', data: { text } })
const reasoning = (text: string): TurnEvent => ({ type: 'reasoning', data: { text } })
const output = (text: string): TurnEvent => ({ type: 'output', data: { text } })
const call = (id: string, name: string): TurnEvent => ({
  type: 'tool_call',
  data: { id, name, args: '{}' },
})
const result = (id: string, name: string, status = 'ok', output = 'ok'): TurnEvent => ({
  type: 'tool_result',
  data: { id, name, status, seconds: 0.4, output, truncated: false },
})
const usage = (out: number, decodeMs: number, cached = 0, prompt = 0): TurnEvent => ({
  type: 'usage',
  data: {
    in_tokens: prompt,
    out_tokens: out,
    total_tokens: prompt + out,
    cached_tokens: cached,
    prompt_tokens: prompt,
    request_ms: decodeMs + 100,
    decode_ms: decodeMs,
  },
})

describe('live turn — text and reasoning', () => {
  test('deltas accumulate in order', () => {
    const live = foldEvents([token('你好'), token('，'), reasoning('先看现状'), token('世界')])
    expect(live.text).toBe('你好，世界')
    expect(live.reasoning).toBe('先看现状')
  })

  test('captured stdout is only a fallback, dropped once tokens arrive', () => {
    const live = emptyLiveTurn()
    applyEvent(live, output('[progress] connecting\n'))
    expect(liveText(live)).toBe('[progress] connecting\n')
    applyEvent(live, token('real answer'))
    // the raw capture duplicates the semantic stream; it must not be shown twice
    expect(liveText(live)).toBe('real answer')
    applyEvent(live, output('more terminal noise'))
    expect(liveText(live)).toBe('real answer')
  })
})

describe('live turn — tool calls', () => {
  test('a call starts running and its result lands on the right call', () => {
    const live = foldEvents([
      call('a', 'read'),
      call('b', 'read'), // same tool twice: pairing must not guess
      result('b', 'read', 'ok', 'second file'),
      result('a', 'read', 'ok', 'first file'),
    ])
    expect(live.tools.map((t) => t.status)).toEqual(['ok', 'ok'])
    expect(live.tools[0].output).toBe('first file')
    expect(live.tools[1].output).toBe('second file')
    expect(live.tools[0].seconds).toBe(0.4)
  })

  test('a missing id falls back to the first running call of that name', () => {
    const live = foldEvents([call('a', 'exec'), result('', 'exec', 'ok')])
    expect(live.tools[0].status).toBe('ok')
  })

  test('kernel statuses map onto the four the UI renders', () => {
    expect(toolStatusOf('ok')).toBe('ok')
    expect(toolStatusOf('blocked')).toBe('blocked')
    for (const s of ['failed', 'unknown', 'exception', '']) expect(toolStatusOf(s)).toBe('failed')
  })

  test('a result for an unknown call is ignored rather than invented', () => {
    const live = foldEvents([result('ghost', 'read')])
    expect(live.tools.length).toBe(0)
  })

  test('a truncated result says so', () => {
    const live = foldEvents([
      call('a', 'exec'),
      { type: 'tool_result', data: { id: 'a', name: 'exec', status: 'ok', seconds: 1, output: 'x', truncated: true } },
    ])
    expect(live.tools[0].output).toContain('截断')
  })
})

describe('live turn — accounting', () => {
  test('several requests in one turn accumulate', () => {
    const live = foldEvents([usage(100, 1000, 90, 100), usage(50, 500, 10, 60)])
    expect(live.usage?.requests).toBe(2)
    expect(live.usage?.outTokens).toBe(150)
    expect(live.usage?.decodeMs).toBe(1500)
    expect(live.usage?.cachedTokens).toBe(100)
    expect(live.usage?.promptTokens).toBe(160)
  })

  test('the decode rate uses the decode window, not the whole request', () => {
    const live = foldEvents([usage(200, 1000)])
    expect(liveTokensPerSecond(live)).toBeCloseTo(200, 5)
    // nothing decoded yet: a dash, never an invented zero
    expect(liveTokensPerSecond(emptyLiveTurn())).toBeUndefined()
    expect(liveTokensPerSecond(foldEvents([usage(0, 0)]))).toBeUndefined()
  })

  test('the cache hit is measured against the reported prompt total', () => {
    expect(liveCacheHit(foldEvents([usage(10, 100, 90, 100)]))).toBeCloseTo(0.9, 5)
    // a provider that reports no cache: undefined, not 0%
    expect(liveCacheHit(foldEvents([usage(10, 100, 0, 100)]))).toBeUndefined()
    expect(liveCacheHit(emptyLiveTurn())).toBeUndefined()
  })

  test('an interrupt marks the partial answer as final', () => {
    const live = foldEvents([token('half an ans'), { type: 'interrupt', data: { partial_chars: 11 } }])
    expect(live.interrupted).toBe(true)
    expect(live.text).toBe('half an ans')
  })

  test('events the live turn does not care about are ignored', () => {
    const live = foldEvents([
      { type: 'turn_start', data: { session: 's', model: 'm' } },
      { type: 'approval_request', data: { request_id: 'r', tool: 'exec', args: '{}' } },
      { type: 'turn_done', data: { rc: 0, interrupted: false } },
    ])
    expect(live).toEqual(emptyLiveTurn())
  })
})
