// Guardrails: error classification and permission fences.
//
// Both port a rule from the reference desktop harness: **route on code, never by
// parsing message**, and make the fence a *replayable* derived value rather than
// an opaque external switch. Every case here is pure logic so it can be driven
// without a kernel.
//
// Run: bun test tests/
import { describe, expect, test } from 'bun:test'
import {
  classifyError,
  describeError,
  type CellErrorView,
} from '../src/lib/errors'
import {
  applyPreset,
  canEscalate,
  escalate,
  fromKernelConfig,
  normalize,
  toKernelPatch,
  type SandboxMode,
} from '../src/lib/permissions'

describe('error classification (route on code, never on message)', () => {
  test('unauthorized -> auth, not retryable, asks to re-authenticate', () => {
    const v = classifyError({ status: 401, code: 'unauthorized', message: 'missing token' })
    expect(v.code).toBe('unauthorized')
    expect(v.category).toBe('auth')
    expect(v.retryable).toBe(false)
    expect(v.action).toBe('authenticate')
  })

  test('rate limit -> budget, retryable', () => {
    const v = classifyError({ status: 429, code: 'rate_limit', message: 'slow down' })
    expect(v.code).toBe('rate_limit')
    expect(v.category).toBe('budget')
    expect(v.retryable).toBe(true)
  })

  test('5xx maps to internal and stays retryable', () => {
    const v = classifyError({ status: 500, code: 'internal', message: 'boom' })
    expect(v.code).toBe('internal')
    expect(v.retryable).toBe(true)
  })

  test('a transport failure (no status/code) is retryable', () => {
    const v = classifyError(new TypeError('Failed to fetch'))
    expect(v.code).toBe('transport')
    expect(v.category).toBe('transport')
    expect(v.retryable).toBe(true)
    expect(v.action).toBe('reconnect')
  })

  test('an aborted request is not an error to retry', () => {
    const e = new Error('aborted')
    e.name = 'AbortError'
    const v = classifyError(e)
    expect(v.code).toBe('aborted')
    expect(v.retryable).toBe(false)
  })

  test('SSE error frames classify by their code', () => {
    // the kernel pushes {"type":"error","data":{"code":...,"message":...}}
    expect(classifyError({ code: 'capture_failed', message: 'x' }).code).toBe('capture_failed')
    expect(classifyError({ code: 'internal', message: 'x' }).code).toBe('internal')
    expect(classifyError({ code: 'provider_unreachable', message: 'x' }).category).toBe('provider')
    expect(classifyError({ code: 'context_window', message: 'x' }).action).toBe('compact')
  })

  test('an unrecognised code degrades to unknown but keeps the raw code', () => {
    const v = classifyError({ code: 'totally_new_code', message: 'x' })
    expect(v.code).toBe('unknown')
    expect(v.raw).toBe('totally_new_code')
  })

  test('junk input never throws', () => {
    for (const junk of [undefined, null, 0, '', {}, 'string']) {
      const v: CellErrorView = classifyError(junk)
      expect(typeof v.code).toBe('string')
      expect(v.title.length).toBeGreaterThan(0)
    }
  })

  test('describeError renders one line for a toast', () => {
    const text = describeError(classifyError({ status: 401, code: 'unauthorized', message: 'x' }))
    expect(text).toContain('unauthorized')
  })
})

describe('permission fences', () => {
  test('presets map to the kernel sandbox vocabulary', () => {
    // cell.cpp: sandbox_mode is "read-only" | "edit-only" | "full-access"
    expect(applyPreset('safe').sandbox).toBe('read-only')
    expect(applyPreset('standard').sandbox).toBe('edit-only')
    expect(applyPreset('auto').sandbox).toBe('full-access')
    expect(applyPreset('auto').approval).toBe('never')
  })

  test('autoallow is only honoured in full-access (kernel invariant)', () => {
    // cell.cpp gates autoallow on SandboxMode::FullAccess, so a selection that
    // asks for auto-allow under a tighter mode must be normalised, not trusted
    const sel = normalize({ sandbox: 'read-only', approval: 'never' })
    expect(sel.sandbox).toBe('read-only')
    expect(sel.approval).toBe('ask')
  })

  test('escalation is strictly widening and monotonic', () => {
    expect(canEscalate('read-only', 'edit-only')).toBe(true)
    expect(canEscalate('read-only', 'full-access')).toBe(true)
    expect(canEscalate('full-access', 'read-only')).toBe(false)
    expect(canEscalate('edit-only', 'edit-only')).toBe(false)
    expect(escalate('edit-only', 'full-access')).toBe('full-access')
    expect(() => escalate('full-access', 'read-only')).toThrow(/not strictly wider/)
  })

  test('round-trips through the kernel config shape', () => {
    const cfg = { sandbox_mode: 'edit-only', autoallow: false }
    const sel = fromKernelConfig(cfg)
    expect(sel.sandbox).toBe('edit-only')
    expect(sel.approval).toBe('ask')
    expect(toKernelPatch(sel)).toEqual({ sandbox_mode: 'edit-only', autoallow: false })

    const auto = fromKernelConfig({ sandbox_mode: 'full-access', autoallow: true })
    expect(auto.approval).toBe('never')
    expect(auto.preset).toBe('auto')
  })

  test('unknown / malformed kernel values fall back to a known fence', () => {
    const sel = fromKernelConfig({ sandbox_mode: 'something-else' as SandboxMode, autoallow: true })
    expect(['read-only', 'edit-only', 'full-access']).toContain(sel.sandbox)
    expect(sel.preset).toBe('custom')
  })

  test('a hand-built selection that matches no preset is custom', () => {
    expect(normalize({ sandbox: 'full-access', approval: 'ask' }).preset).toBe('custom')
  })
})
