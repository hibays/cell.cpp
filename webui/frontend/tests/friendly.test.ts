// Friendly-failure tests.
//
// The rule: the shell never shows the browser's own words. "TypeError: Failed to
// fetch" is what a user gets from `String(e)`, and it explains nothing — the
// whole point of this module is that a failure arrives as a sentence with a next
// step in it.
//
// Run: bun test tests/
import { describe, expect, test } from 'bun:test'
import { friendlyError, pollQuiet } from '../src/lib/friendly'

describe('friendlyError', () => {
  test('a network failure says what to do, in the shell voice', () => {
    const e = Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' })
    const text = friendlyError(e)
    expect(text).toContain('本地内核')
    expect(text).not.toContain('Failed to fetch')
  })

  test('a provider rejection points at the provider settings', () => {
    const e = Object.assign(new Error('boom'), { status: 502, code: 'provider_unreachable' })
    expect(friendlyError(e)).toContain('服务商')
  })

  test('an unknown failure keeps its detail, because that is when detail helps', () => {
    const e = Object.assign(new Error('weird internal thing'), { code: 'not_a_known_code' })
    expect(friendlyError(e)).toContain('weird internal thing')
  })

  test('an object with no message never renders as [object Object]', () => {
    expect(friendlyError({ code: 'not_a_known_code' })).not.toContain('[object Object]')
  })

  test('a bare network message is dropped even when the code is unknown', () => {
    expect(friendlyError(new Error('  load failed '))).not.toContain('load failed')
  })
})

describe('pollQuiet', () => {
  test('a first failure that recovers is not an error the caller sees', async () => {
    let calls = 0
    const out = await pollQuiet(async () => {
      calls++
      if (calls === 1) throw new Error('blip')
      return 'ok'
    }, 1)
    expect(out).toBe('ok')
    expect(calls).toBe(2)
  })

  test('two failures resolve to null rather than throwing at a poller', async () => {
    let calls = 0
    const out = await pollQuiet(async () => {
      calls++
      throw new Error('down')
    }, 1)
    expect(out).toBeNull()
    expect(calls).toBe(2)
  })

  test('a success does not retry', async () => {
    let calls = 0
    const out = await pollQuiet(async () => {
      calls++
      return 7
    }, 1)
    expect(out).toBe(7)
    expect(calls).toBe(1)
  })
})
