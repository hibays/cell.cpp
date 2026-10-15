// Output clipping for tool cards.
//
// Tool output is arbitrary — a build log or `cat` of a big file is megabytes.
// Collapsed we want the tail (that is where a failure is); expanded we still cap
// the DOM, because rendering 5 MB of <pre> freezes the renderer and a frozen UI
// hides the very error the card was opened to read.
//
// Run: bun test tests/
import { describe, expect, test } from 'bun:test'
import { clipOutput } from '../src/lib/format'

const OPTS = { tail: 10, cap: 30, expand: false }

describe('tool output clipping', () => {
  test('short output is returned whole', () => {
    const r = clipOutput('abc', OPTS)
    expect(r.text).toBe('abc')
    expect(r.cut).toBe(false)
    expect(r.fromEnd).toBe(false)
  })

  test('collapsed long output shows the tail', () => {
    const r = clipOutput('0123456789ABCDEFGHIJ', OPTS)
    expect(r.text).toBe('ABCDEFGHIJ')
    expect(r.cut).toBe(true)
    expect(r.fromEnd).toBe(true)
  })

  test('expanded output shows the head, capped for the DOM', () => {
    const r = clipOutput('x'.repeat(50), { ...OPTS, expand: true })
    expect(r.text).toHaveLength(30)
    expect(r.cut).toBe(true)
    expect(r.fromEnd).toBe(false)
  })

  test('expanded output under the cap is whole again', () => {
    const r = clipOutput('y'.repeat(25), { ...OPTS, expand: true })
    expect(r.text).toBe('y'.repeat(25))
    expect(r.cut).toBe(false)
  })

  test('the cap is never exceeded, whatever the input', () => {
    const r = clipOutput('z'.repeat(1_000_000), { ...OPTS, expand: true })
    expect(r.text.length).toBeLessThanOrEqual(30)
  })

  test('missing output degrades to empty, not to a crash', () => {
    for (const v of [undefined, '', null as unknown as string]) {
      const r = clipOutput(v, OPTS)
      expect(r.text).toBe('')
      expect(r.cut).toBe(false)
    }
  })
})
