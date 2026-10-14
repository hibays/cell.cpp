// Frame-batched publication.
//
// A stream turn can emit hundreds of deltas per second; publishing each one
// straight into Vue's reactivity means hundreds of renders and a page that
// stops responding to input. Ported from the reference desktop harness:
// coalesce requests and publish at most once per frame window (three frames by
// default, which is what keeps the paint smooth without feeling laggy).
//
// rAF is injected rather than taken from `window`, so this is testable with fake
// frames and usable in any host.

export interface FrameSchedulerOptions {
  raf: (cb: () => void) => number
  cancel?: (handle: number) => void
  /** Frames to wait before publishing. Default 3 (triple rAF). */
  frames?: number
}

export interface FrameScheduler {
  /** Ask for a publish. Cheap and idempotent within a burst. */
  request(): void
  /** Publish now, discarding the pending frame (e.g. on turn end). */
  flushNow(): void
  /** Drop the pending publish (e.g. on unmount). */
  cancel(): void
  /** True while a publish is scheduled — drives the "streaming" affordance. */
  readonly pending: boolean
}

export function createFrameScheduler(
  flush: () => void,
  opts: FrameSchedulerOptions,
): FrameScheduler {
  const frames = Math.max(1, opts.frames ?? 3)
  let handle: number | null = null
  let remaining = 0
  let generation = 0

  const clear = () => {
    if (handle !== null) {
      opts.cancel?.(handle)
      handle = null
    }
  }

  const publish = () => {
    handle = null
    remaining = 0
    flush()
  }

  const step = (gen: number) => () => {
    // a flushNow()/cancel() in between invalidates this queued frame
    if (gen !== generation) return
    handle = null
    remaining -= 1
    if (remaining <= 0) {
      publish()
      return
    }
    handle = opts.raf(step(gen))
  }

  return {
    get pending() {
      return handle !== null
    },
    request() {
      if (handle !== null) return // already coalescing this burst
      remaining = frames
      handle = opts.raf(step(generation))
    },
    flushNow() {
      if (handle === null) return
      generation += 1 // invalidate the queued frame
      clear()
      publish()
    },
    cancel() {
      if (handle === null) return
      generation += 1
      clear()
    },
  }
}
