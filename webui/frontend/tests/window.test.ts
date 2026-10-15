// Long-session windowing.
//
// A session with hundreds of turns currently mounts every message: the DOM grows
// without bound and scrolling degrades. The list is windowed instead — only the
// rows near the viewport are mounted, with spacer heights standing in for the
// rest so the scrollbar still reflects the real size.
//
// Run: bun test tests/
import { describe, expect, test } from 'bun:test'
import { computeWindow } from '../src/lib/window'

const uniform = (n: number, h = 100) => Array.from({ length: n }, () => h)

describe('list windowing', () => {
  test('an empty list yields an empty window', () => {
    expect(computeWindow({ count: 0, heights: [], scrollTop: 0, viewport: 600 })).toEqual({
      start: 0,
      end: 0,
      padTop: 0,
      padBottom: 0,
    })
  })

  test('a short list is rendered whole', () => {
    const w = computeWindow({ count: 3, heights: uniform(3), scrollTop: 0, viewport: 600 })
    expect(w.start).toBe(0)
    expect(w.end).toBe(3)
    expect(w.padTop).toBe(0)
    expect(w.padBottom).toBe(0)
  })

  test('spacers account for every unmounted row', () => {
    const heights = uniform(50) // 5000px total
    const w = computeWindow({ count: 50, heights, scrollTop: 2000, viewport: 600, overscan: 0 })
    // 2000..2600 -> rows 20..26
    expect(w.start).toBe(20)
    expect(w.end).toBe(26)
    expect(w.padTop).toBe(2000)
    expect(w.padBottom).toBe(5000 - 2600)
    // the spacers plus the mounted rows must equal the full content height
    const mounted = heights.slice(w.start, w.end).reduce((a, b) => a + b, 0)
    expect(w.padTop + mounted + w.padBottom).toBe(5000)
  })

  test('overscan mounts a margin on both sides', () => {
    const heights = uniform(50)
    const w = computeWindow({ count: 50, heights, scrollTop: 2000, viewport: 600, overscan: 3 })
    expect(w.start).toBe(17)
    expect(w.end).toBe(29)
  })

  test('the window is clamped at the top and at the bottom', () => {
    const heights = uniform(50)
    const top = computeWindow({ count: 50, heights, scrollTop: 0, viewport: 600, overscan: 2 })
    expect(top.start).toBe(0)
    const bottom = computeWindow({ count: 50, heights, scrollTop: 100_000, viewport: 600, overscan: 2 })
    expect(bottom.end).toBe(50)
    expect(bottom.padBottom).toBe(0)
  })

  test('rows without a measured height fall back to the estimate', () => {
    // only the first two rows measured; the rest are still unknown
    const w = computeWindow({
      count: 10,
      heights: [100, 100],
      estimate: 50,
      scrollTop: 0,
      viewport: 300,
      overscan: 0,
    })
    expect(w.start).toBe(0)
    expect(w.padTop + w.padBottom).toBeGreaterThan(0) // the tail is a spacer
    // rows 0..3 are visible in a 300px viewport (100+100+50+50), so the spacer
    // covers the remaining 6 rows × 50 = 300
    expect(w.end).toBe(4)
    expect(w.padBottom).toBe(300)
  })

  test('a zero-height viewport still yields a usable range', () => {
    const w = computeWindow({ count: 10, heights: uniform(10), scrollTop: 0, viewport: 0, overscan: 1 })
    expect(w.end).toBeGreaterThan(w.start)
    expect(w.start).toBeGreaterThanOrEqual(0)
  })
})
