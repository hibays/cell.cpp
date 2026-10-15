// List windowing for long sessions.
//
// A session with hundreds of turns used to mount every message: the DOM grew
// without bound and scrolling degraded. Only the rows near the viewport are
// mounted now, with spacer heights standing in for the rest so the scrollbar
// still reflects the real content size.
//
// Heights are supplied per row when known (measured) and fall back to an
// estimate for rows that have never been rendered — which is every row below the
// fold on first paint. Because the spacers are recomputed from the same array,
// padTop + mounted + padBottom always equals the total height: the scrollbar
// never lies, and measured rows refine their own estimate as they scroll past.

export interface WindowInput {
  count: number
  /** Known height per row; missing/zero entries fall back to `estimate`. */
  heights: number[]
  scrollTop: number
  viewport: number
  /** Rows to mount beyond the visible range. Default 2. */
  overscan?: number
  /** Height used for rows with no measurement. Default 100 (or the last known). */
  estimate?: number
}

export interface WindowRange {
  /** First mounted row (inclusive). */
  start: number
  /** Last mounted row (exclusive). */
  end: number
  /** Spacer height before `start`. */
  padTop: number
  /** Spacer height after `end`. */
  padBottom: number
}

export function computeWindow(input: WindowInput): WindowRange {
  const { count, scrollTop, viewport } = input
  if (!Number.isFinite(count) || count <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 }

  const overscan = Math.max(0, input.overscan ?? 2)
  const heights = input.heights
  const fallback =
    input.estimate && input.estimate > 0
      ? input.estimate
      : heights.length > 0 && heights[heights.length - 1] > 0
        ? heights[heights.length - 1]
        : 100
  const heightAt = (i: number): number => {
    const h = heights[i]
    return typeof h === 'number' && h > 0 ? h : fallback
  }

  const top = Math.max(0, scrollTop)
  const bottom = top + Math.max(0, viewport)

  // first row that is not entirely above the viewport
  let start = count
  let offset = 0
  for (let i = 0; i < count; i++) {
    const h = heightAt(i)
    if (offset + h > top) {
      start = i
      break
    }
    offset += h
  }
  // first row that starts at or below the viewport bottom
  let end = count
  let cursor = offset
  for (let i = start; i < count; i++) {
    if (cursor >= bottom) {
      end = i
      break
    }
    cursor += heightAt(i)
  }

  start = Math.max(0, start - overscan)
  end = Math.min(count, end + overscan)
  // a degenerate viewport (height 0) must still mount something
  if (end <= start) end = Math.min(count, start + 1)

  let padTop = 0
  for (let i = 0; i < start; i++) padTop += heightAt(i)
  let padBottom = 0
  for (let i = end; i < count; i++) padBottom += heightAt(i)

  return { start, end, padTop, padBottom }
}
