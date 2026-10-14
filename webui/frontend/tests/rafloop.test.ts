// Self-rescheduling animation loop lifecycle.
//
// The landing shader owns a rAF loop that reschedules itself every frame. The
// bug it had: teardown cancelled only the *currently pending* frame, so a loop
// that started late (the GPU init is awaited, and the component can unmount
// while that await is in flight) kept running forever on a detached canvas —
// navigating landing -> chat -> landing stacked loops.
//
// These tests pin the semantics that make teardown total: after stop() no step
// may run and no frame may be scheduled, whether the stop happens outside the
// frame or from inside the step itself.
//
// Run: bun test tests/
import { describe, expect, test } from 'bun:test'
import { createRafLoop } from '../src/lib/rafLoop'

function fakeFrames() {
  let queue: Array<() => void> = []
  let next = 1
  return {
    raf: (cb: () => void) => {
      queue.push(cb)
      return next++
    },
    cancel: () => {},
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

describe('rAF loop lifecycle', () => {
  test('steps once per frame and keeps rescheduling', () => {
    const f = fakeFrames()
    let n = 0
    const loop = createRafLoop(() => {
      n += 1
    }, f)
    loop.start()
    expect(n).toBe(0) // nothing runs synchronously
    f.tick()
    expect(n).toBe(1)
    f.tick()
    expect(n).toBe(2)
    expect(loop.running).toBe(true)
  })

  test('after stop no step runs and no frame is scheduled', () => {
    const f = fakeFrames()
    let n = 0
    const loop = createRafLoop(() => {
      n += 1
    }, f)
    loop.start()
    f.tick()
    loop.stop()
    expect(loop.running).toBe(false)
    f.tick()
    f.tick()
    expect(n).toBe(1)
    expect(f.queued).toBe(0)
  })

  test('a frame already queued at stop time must not fire', () => {
    const f = fakeFrames()
    let n = 0
    const loop = createRafLoop(() => {
      n += 1
    }, f)
    loop.start()
    // the frame is queued but not yet run; stopping now must neutralise it
    loop.stop()
    f.tick()
    expect(n).toBe(0)
  })

  test('starting twice does not create two concurrent chains', () => {
    const f = fakeFrames()
    let n = 0
    const loop = createRafLoop(() => {
      n += 1
    }, f)
    loop.start()
    loop.start()
    f.tick()
    expect(n).toBe(1) // a doubled chain would run the body twice per frame
  })

  test('stopping from inside the step stops the chain (unmount during a frame)', () => {
    const f = fakeFrames()
    let n = 0
    const loop = createRafLoop(() => {
      n += 1
      loop.stop()
    }, f)
    loop.start()
    f.tick()
    expect(n).toBe(1)
    f.tick()
    expect(n).toBe(1)
    expect(f.queued).toBe(0)
  })

  test('stop is idempotent and the loop can be restarted', () => {
    const f = fakeFrames()
    let n = 0
    const loop = createRafLoop(() => {
      n += 1
    }, f)
    loop.stop() // never started
    loop.start()
    f.tick()
    loop.stop()
    loop.stop()
    expect(n).toBe(1)
    loop.start()
    f.tick()
    expect(n).toBe(2)
  })
})
