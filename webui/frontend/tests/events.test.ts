// Typed UI callbacks for the turn event stream.
//
// The kernel emits five SSE event types (turn_start, output, approval_request,
// error, turn_done). Today the UI handles them in one inline switch, which means
// every new event type is a new branch in one function. The reference desktop
// harness instead exposes a typed callback registry, so this module provides
// that plus a tolerant parser.
//
// The parser is deliberately forward-compatible: a kernel that starts emitting a
// new event type must not break an older shell, so unknown types parse to null
// and are dropped rather than routed.
//
// Run: bun test tests/
import { describe, expect, test } from 'bun:test'
import { createEventBus, parseEvent } from '../src/lib/events'

describe('event parsing (tolerant, forward-compatible)', () => {
  test('parses each kernel event type', () => {
    const start = parseEvent({ type: 'turn_start', data: { session: 's1', model: 'm' } })
    expect(start?.type).toBe('turn_start')

    const out = parseEvent({ type: 'output', data: { text: 'hello' } })
    expect(out?.type === 'output' && out.data.text).toBe('hello')

    const appr = parseEvent({ type: 'approval_request', data: { request_id: 'r', tool: 'exec', args: 'x' } })
    expect(appr?.type).toBe('approval_request')

    const err = parseEvent({ type: 'error', data: { code: 'internal', message: 'boom' } })
    expect(err?.type === 'error' && err.data.code).toBe('internal')

    const done = parseEvent({ type: 'turn_done', data: { rc: 0, interrupted: false } })
    expect(done?.type).toBe('turn_done')
  })

  test('an unknown event type is dropped, not routed (forward compatibility)', () => {
    // a newer kernel emitting e.g. tool_start must not crash an older shell
    expect(parseEvent({ type: 'tool_start', data: {} })).toBeNull()
    expect(parseEvent({ type: 'output_from_the_future', data: {} })).toBeNull()
  })

  test('malformed frames never throw', () => {
    for (const junk of [null, undefined, 42, 'x', [], {}, { type: 1 }, { type: 'output' }]) {
      expect(parseEvent(junk)).toBeNull()
    }
  })

  test('missing fields are coerced to usable defaults', () => {
    const out = parseEvent({ type: 'output', data: {} })
    expect(out?.type === 'output' && out.data.text).toBe('')
    const done = parseEvent({ type: 'turn_done', data: {} })
    expect(done?.type === 'turn_done' && done.data.rc).toBe(0)
    expect(done?.type === 'turn_done' && done.data.interrupted).toBe(false)
  })
})

describe('event bus (typed UI callbacks)', () => {
  test('subscribers are called only for their event type', () => {
    const bus = createEventBus()
    const seen: string[] = []
    bus.on('output', (e) => seen.push(e.type === 'output' ? e.data.text : '?'))
    bus.on('turn_done', () => seen.push('done'))

    bus.emit({ type: 'output', data: { text: 'a' } })
    bus.emit({ type: 'turn_done', data: { rc: 0, interrupted: false } })

    expect(seen).toEqual(['a', 'done'])
  })

  test('the wildcard subscription sees every event', () => {
    const bus = createEventBus()
    const types: string[] = []
    bus.onAny((e) => types.push(e.type))
    bus.emit({ type: 'turn_start', data: { session: 's', model: 'm' } })
    bus.emit({ type: 'output', data: { text: 'x' } })
    expect(types).toEqual(['turn_start', 'output'])
  })

  test('unsubscribe stops delivery', () => {
    const bus = createEventBus()
    let n = 0
    const off = bus.on('output', () => {
      n += 1
    })
    bus.emit({ type: 'output', data: { text: 'a' } })
    off()
    bus.emit({ type: 'output', data: { text: 'b' } })
    expect(n).toBe(1)
  })

  test('a throwing handler does not stop the other handlers', () => {
    const bus = createEventBus()
    const seen: string[] = []
    bus.on('output', () => {
      throw new Error('bad handler')
    })
    bus.on('output', () => seen.push('second'))
    // must not propagate: the SSE reader would otherwise tear down the turn
    expect(() => bus.emit({ type: 'output', data: { text: 'a' } })).not.toThrow()
    expect(seen).toEqual(['second'])
  })

  test('emit ignores events that did not parse', () => {
    const bus = createEventBus()
    let n = 0
    bus.onAny(() => {
      n += 1
    })
    bus.emitRaw({ type: 'unknown_kind', data: {} })
    bus.emitRaw('not an object')
    expect(n).toBe(0)
  })
})
