// Approval-history tests.
//
// The rule under test is that a human can read the audit: the telling field out
// of the arguments, the same risk classification the live card uses, and honest
// counts. A malformed audit line must not break the panel.
//
// Run: bun test tests/
import { describe, expect, test } from 'bun:test'
import {
  approvalStats,
  decisionLabel,
  decisionTone,
  riskOf,
  summarizeArgs,
  type ApprovalRecord,
} from '../src/lib/approvals'

const row = (over: Partial<ApprovalRecord> = {}): ApprovalRecord => ({
  id: 'rq-1',
  session: 's',
  tool: 'exec',
  args: '{"cmd":"echo hi"}',
  decision: 'allow',
  reason: '',
  at: 1760000000,
  ...over,
})

describe('summarizeArgs', () => {
  test('the telling field wins, in a human order', () => {
    expect(summarizeArgs('{"cmd":"git status","cwd":"/repo"}')).toBe('git status')
    // for an edit, the file identifies the call better than the snippet in it
    expect(summarizeArgs('{"search":"foo","path":"src/a.ts"}')).toBe('src/a.ts')
    expect(summarizeArgs('{"path":"src/a.ts"}')).toBe('src/a.ts')
    expect(summarizeArgs('{"pattern":"TODO","cwd":"/repo"}')).toBe('TODO')
  })

  test('falls back to any string value, then to the key names', () => {
    expect(summarizeArgs('{"limit":3,"name":"widget"}')).toBe('widget')
    expect(summarizeArgs('{"a":1,"b":2}')).toBe('a, b')
  })

  test('malformed or empty arguments never throw', () => {
    expect(summarizeArgs('{"cmd":"half')).toBe('{"cmd":"half')
    expect(summarizeArgs('')).toBe('')
    expect(summarizeArgs('   ')).toBe('')
  })

  test('long values are clipped with an ellipsis, not dropped', () => {
    expect(summarizeArgs(`{"cmd":"${'x'.repeat(300)}"}`, 40)).toHaveLength(41)
  })
})

describe('risk', () => {
  test('the destructive shapes are high risk', () => {
    for (const cmd of ['rm -rf /tmp/x', 'sudo apt install', 'git push origin main', 'mkfs.ext4 /dev/sda']) {
      expect(riskOf(cmd)).toBe('high')
    }
  })

  test('ordinary work is not', () => {
    for (const cmd of ['echo hi', 'git status', 'ls -la', 'npm test']) expect(riskOf(cmd)).toBe('normal')
  })
})

describe('decisions and counts', () => {
  test('allow reads as ok and anything else as a refusal', () => {
    expect(decisionTone('allow')).toBe('ok')
    expect(decisionTone('deny')).toBe('bad')
    expect(decisionTone('whatever')).toBe('bad')
    expect(decisionLabel('allow')).toBe('允许')
    expect(decisionLabel('deny')).toBe('拒绝')
  })

  test('the summary counts decisions and high-risk calls', () => {
    const rows = [
      row({ id: '1', decision: 'allow', tool: 'read', args: '{"path":"a.ts"}' }),
      row({ id: '2', decision: 'deny', tool: 'exec', args: '{"cmd":"rm -rf build"}' }),
      row({ id: '3', decision: 'allow', tool: 'exec', args: '{"cmd":"npm test"}' }),
    ]
    expect(approvalStats(rows)).toEqual({ total: 3, allowed: 2, denied: 1, highRisk: 1 })
    expect(approvalStats([])).toEqual({ total: 0, allowed: 0, denied: 0, highRisk: 0 })
  })
})