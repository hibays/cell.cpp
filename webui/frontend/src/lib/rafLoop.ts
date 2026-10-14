// Self-rescheduling animation loop with total teardown.
//
// A loop that schedules its own next frame is easy to leak: cancelling "the
// pending frame" only works while the handle is current, and a loop that starts
// after teardown ran (an awaited init finishing late) is never cancelled at all.
//
// Hence a generation token: stop() invalidates the generation, so a frame that
// was already queued at stop time runs no step and schedules no successor. The
// loop is also restartable, and start() is idempotent so a double call cannot
// produce two chains driving the same canvas.
//
// rAF is injected so this is testable with fake frames and usable in any host.

export interface RafLoop {
  start(): void
  stop(): void
  readonly running: boolean
}

export interface RafLoopOptions {
  raf: (cb: () => void) => number
  cancel?: (handle: number) => void
}

export function createRafLoop(step: () => void, opts: RafLoopOptions): RafLoop {
  let handle: number | null = null
  let generation = 0
  let running = false

  const frame = (gen: number) => () => {
    // a frame that was queued before stop() (or before a restart) is void
    if (!running || gen !== generation) return
    handle = null
    step()
    // the step itself may have stopped us — do not schedule a successor
    if (!running || gen !== generation) return
    handle = opts.raf(frame(gen))
  }

  return {
    get running() {
      return running
    },
    start() {
      if (running) return
      running = true
      generation += 1
      handle = opts.raf(frame(generation))
    },
    stop() {
      if (!running) return
      running = false
      generation += 1
      if (handle !== null) {
        opts.cancel?.(handle)
        handle = null
      }
    },
  }
}
