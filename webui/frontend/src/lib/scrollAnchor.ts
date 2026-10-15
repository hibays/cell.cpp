// Scroll ownership for a streaming transcript.
//
// The view follows new output only while the reader is at the bottom. The subtle
// part is that the app scrolls too: assigning scrollTop fires the very same
// scroll event a gesture does, so "am I near the bottom?" read from the event
// alone treats our own pin as user intent — the view then either fights the
// reader or silently stops following.
//
// So the source is explicit: a programmatic scroll never changes ownership.

export interface ScrollMetrics {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

/** Who caused this scroll: the reader, or us pinning the tail. */
export type ScrollSource = 'user' | 'programmatic'

export interface ScrollAnchorOptions {
  /** Distance from the bottom still treated as "following". */
  threshold?: number
}

export interface ScrollAnchor {
  /** Follow new content. */
  readonly stick: boolean
  /** Offer a "jump to latest" affordance. */
  readonly showJump: boolean
  onScroll(m: ScrollMetrics, source: ScrollSource): void
  /** Content grew; `stick` decides whether the caller should pin the tail. */
  onContentGrown(m: ScrollMetrics): void
  reset(): void
}

export function createScrollAnchor(opts: ScrollAnchorOptions = {}): ScrollAnchor {
  const threshold = opts.threshold ?? 120
  let stick = true
  let showJump = false

  return {
    get stick() {
      return stick
    },
    get showJump() {
      return showJump
    },
    onScroll(m, source) {
      if (source === 'programmatic') return // never let our own pin change ownership
      const distance = m.scrollHeight - m.scrollTop - m.clientHeight
      if (distance <= threshold) {
        stick = true
        showJump = false
      } else {
        stick = false
        showJump = true
      }
    },
    onContentGrown() {
      if (!stick) showJump = true
    },
    reset() {
      stick = true
      showJump = false
    },
  }
}
