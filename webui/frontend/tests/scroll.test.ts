// Scroll ownership.
//
// The chat follows new output only while the user is at the bottom. The subtle
// part is that the app scrolls too: assigning scrollTop fires the same scroll
// event a user gesture does, so a naive "am I near the bottom?" check reads our
// own programmatic scroll as user intent and either fights the reader or
// silently stops following. Ownership is therefore explicit.
//
// Run: bun test tests/
import { describe, expect, test } from 'bun:test'
import { createScrollAnchor } from '../src/lib/scrollAnchor'

const BOTTOM = { scrollTop: 900, scrollHeight: 1000, clientHeight: 100 }

describe('scroll ownership', () => {
  test('starts following the tail', () => {
    const a = createScrollAnchor()
    expect(a.stick).toBe(true)
    expect(a.showJump).toBe(false)
  })

  test('a user scrolling up takes ownership and offers a jump back', () => {
    const a = createScrollAnchor()
    a.onScroll({ scrollTop: 200, scrollHeight: 1000, clientHeight: 100 }, 'user')
    expect(a.stick).toBe(false)
    expect(a.showJump).toBe(true)
  })

  test('our own scroll is never mistaken for the user leaving the bottom', () => {
    const a = createScrollAnchor()
    // the app pins the tail, which fires a scroll event at the bottom
    a.onScroll(BOTTOM, 'programmatic')
    expect(a.stick).toBe(true)
    expect(a.showJump).toBe(false)
  })

  test('a programmatic scroll that lands mid-list does not steal ownership', () => {
    const a = createScrollAnchor()
    a.onScroll({ scrollTop: 0, scrollHeight: 1000, clientHeight: 100 }, 'programmatic')
    expect(a.stick).toBe(true)
  })

  test('scrolling back to the bottom resumes following', () => {
    const a = createScrollAnchor()
    a.onScroll({ scrollTop: 100, scrollHeight: 1000, clientHeight: 100 }, 'user')
    expect(a.stick).toBe(false)
    a.onScroll(BOTTOM, 'user')
    expect(a.stick).toBe(true)
    expect(a.showJump).toBe(false)
  })

  test('staying just inside the threshold keeps following (no flapping)', () => {
    const a = createScrollAnchor({ threshold: 120 })
    // 60px above the bottom: inside the keep-following band
    a.onScroll({ scrollTop: 840, scrollHeight: 1000, clientHeight: 100 }, 'user')
    expect(a.stick).toBe(true)
    // 200px above: outside it
    a.onScroll({ scrollTop: 700, scrollHeight: 1000, clientHeight: 100 }, 'user')
    expect(a.stick).toBe(false)
  })

  test('content growing while detached keeps the jump affordance', () => {
    const a = createScrollAnchor()
    a.onScroll({ scrollTop: 100, scrollHeight: 1000, clientHeight: 100 }, 'user')
    a.onContentGrown({ scrollTop: 100, scrollHeight: 4000, clientHeight: 100 })
    expect(a.stick).toBe(false)
    expect(a.showJump).toBe(true)
  })

  test('detaching again after a jump re-arms the affordance', () => {
    const a = createScrollAnchor()
    a.onScroll({ scrollTop: 100, scrollHeight: 1000, clientHeight: 100 }, 'user')
    a.reset()
    expect(a.stick).toBe(true)
    expect(a.showJump).toBe(false)
  })
})
