// Runtime behaviour: render scheduling and connection recovery.
//
// Ported from the reference desktop harness's responsiveness rules — coalesce
// high-frequency stream updates across animation frames instead of publishing
// every token, and drive reconnects off an explicit state machine with bounded
// exponential backoff. Both are pure/injectable so they are testable with fake
// timers and frames.
//
// Run: bun test tests/
import { describe, expect, test } from 'bun:test'
import { createFrameScheduler } from '../src/lib/scheduler'
import { createConnection } from '../src/lib/connection'

/** Minimal fake rAF: `tick()` runs exactly one animation frame. */
function fakeFrames() {
  let queue: Array<() => void> = []
  return {
    raf: (cb: () => void) => {
      queue.push(cb)
      return queue.length
    },
    tick() {
      const due = queue
      queue = []
      for (const cb of due) cb()
      return due.length
    },
    get queued() {
      return queue.length
    },
  }
}

describe('frame-batched publication (stream rendering stays responsive)', () => {
  test('many requests inside one burst flush once', () => {
    const f = fakeFrames()
    let flushes = 0
    const s = createFrameScheduler(() => {
      flushes += 1
    }, { raf: f.raf })

    s.request()
    s.request()
    s.request()
    expect(flushes).toBe(0) // nothing published synchronously

    f.tick()
    f.tick()
    expect(flushes).toBe(0) // still coalescing across the frame window
    f.tick()
    expect(flushes).toBe(1) // published once the window elapses
  })

  test('pending is observable so the UI can show a streaming hint', () => {
    const f = fakeFrames()
    const s = createFrameScheduler(() => {}, { raf: f.raf })
    expect(s.pending).toBe(false)
    s.request()
    expect(s.pending).toBe(true)
    f.tick()
    f.tick()
    f.tick()
    expect(s.pending).toBe(false)
  })

  test('flushNow publishes immediately and cancels the pending frame', () => {
    const f = fakeFrames()
    let flushes = 0
    const s = createFrameScheduler(() => {
      flushes += 1
    }, { raf: f.raf })
    s.request()
    s.flushNow()
    expect(flushes).toBe(1)
    expect(s.pending).toBe(false)
    f.tick()
    f.tick()
    f.tick()
    expect(flushes).toBe(1) // the scheduled frame did not double-publish
  })

  test('cancel drops the queued flush', () => {
    const f = fakeFrames()
    let flushes = 0
    const s = createFrameScheduler(() => {
      flushes += 1
    }, { raf: f.raf })
    s.request()
    s.cancel()
    expect(s.pending).toBe(false)
    f.tick()
    f.tick()
    f.tick()
    expect(flushes).toBe(0)
  })
})

describe('connection state machine', () => {
  const cfg = { backoffBaseMs: 500, backoffFactor: 2, backoffMaxMs: 10000 }

  test('starts disconnected and reports transitions to subscribers', () => {
    const c = createConnection(cfg)
    const seen: string[] = []
    c.onStateChange((s) => seen.push(s))
    expect(c.state).toBe('disconnected')
    c.markConnected()
    expect(c.state).toBe('connected')
    c.markDisconnected()
    expect(c.state).toBe('disconnected')
    expect(seen).toEqual(['connected', 'disconnected'])
  })

  test('backoff grows geometrically and is capped', () => {
    const c = createConnection(cfg)
    expect(c.scheduleRetry()).toBe(500)
    expect(c.scheduleRetry()).toBe(1000)
    expect(c.scheduleRetry()).toBe(2000)
    expect(c.scheduleRetry()).toBe(4000)
    expect(c.scheduleRetry()).toBe(8000)
    expect(c.scheduleRetry()).toBe(10000) // capped
    expect(c.scheduleRetry()).toBe(10000)
  })

  test('a successful connect resets the backoff ladder', () => {
    const c = createConnection(cfg)
    c.scheduleRetry()
    c.scheduleRetry()
    c.markConnected()
    expect(c.attempt).toBe(0)
    expect(c.scheduleRetry()).toBe(500)
  })

  test('reconnect goes straight to connecting without waiting out the backoff', () => {
    const c = createConnection(cfg)
    c.markDisconnected('stream ended')
    c.scheduleRetry()
    c.scheduleRetry()
    c.reconnect()
    expect(c.state).toBe('connecting')
    expect(c.attempt).toBe(0)
    expect(c.lastError).toBe('stream ended')
  })

  test('unsubscribe stops notifications', () => {
    const c = createConnection(cfg)
    const seen: string[] = []
    const off = c.onStateChange((s) => seen.push(s))
    off()
    c.markConnected()
    expect(seen).toEqual([])
  })
})
