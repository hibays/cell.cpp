// Shell derivation tests: the column solver, the session browser, telemetry and
// the trace ledger.
//
// Every one of these is a rule ported from the reference desktop harness, and a
// ported rule without a test is a rule that will silently drift (see the note at
// the top of guardrails.test.ts). All pure functions — no DOM, no kernel.
//
// Run: bun test tests/
import { describe, expect, test } from 'bun:test'
import {
  CENTER_MIN,
  SIDEBAR_AUTO_COLLAPSE,
  SIDEBAR_COLLAPSED,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  clampSidebar,
  gridTemplate,
  solveColumns,
} from '../src/lib/layout'
import {
  COLLAPSED_SESSION_LIMIT,
  filterSessions,
  groupSessions,
  sessionLabel,
  sortByRecency,
  workspaceLabel,
} from '../src/lib/sessions'
import { cacheHitRatio, transcriptStats, usageTotals } from '../src/lib/stats'
import { buildTurns, turnStatus } from '../src/lib/trace'
import { formatCompact, formatPercent, relativeTime } from '../src/lib/format'
import type { SessionSummary } from '../src/lib/api'
import type { UiMessage } from '../src/lib/transcript'

const session = (over: Partial<SessionSummary>): SessionSummary => ({
  id: 'sid-000000',
  cwd: '',
  messages: 0,
  snippet: '',
  title: '',
  updated_at: 0,
  ...over,
})

describe('shell layout — the three-column solver', () => {
  test('CSS solves the squeeze, so the centre keeps its minimum', () => {
    const cols = solveColumns({ width: 1600, sidebarWidth: 300, collapsed: false, rightbarOpen: false, rightbarWidth: 0 })
    expect(gridTemplate(cols)).toBe(`300px minmax(${CENTER_MIN}px, 1fr) 0px`)
  })

  test('a closed right bar collapses to 0px rather than disappearing from the template', () => {
    const closed = solveColumns({ width: 1400, sidebarWidth: 300, collapsed: false, rightbarOpen: false, rightbarWidth: 500 })
    const open = solveColumns({ width: 1400, sidebarWidth: 300, collapsed: false, rightbarOpen: true, rightbarWidth: 500 })
    expect(closed.rightbar).toBe(0)
    expect(open.rightbar).toBeGreaterThan(0)
    expect(gridTemplate(closed).endsWith('0px')).toBe(true)
  })

  test('a narrow frame auto-collapses to the rail and restores the width later', () => {
    const narrow = solveColumns({ width: SIDEBAR_AUTO_COLLAPSE - 1, sidebarWidth: 300, collapsed: false, rightbarOpen: false, rightbarWidth: 0 })
    const wide = solveColumns({ width: 1600, sidebarWidth: 300, collapsed: false, rightbarOpen: false, rightbarWidth: 0 })
    expect(narrow.collapsed).toBe(true)
    expect(narrow.sidebar).toBe(SIDEBAR_COLLAPSED)
    // the preference is remembered, not overwritten by the auto-collapse
    expect(wide.sidebar).toBe(300)
  })

  test('the sidebar is clamped to its allowed band', () => {
    expect(clampSidebar(10)).toBe(SIDEBAR_MIN)
    expect(clampSidebar(9000)).toBe(SIDEBAR_MAX)
    expect(clampSidebar(320)).toBe(320)
  })

  test('the right bar never squeezes the centre below its minimum', () => {
    const cols = solveColumns({ width: 900, sidebarWidth: 280, collapsed: true, rightbarOpen: true, rightbarWidth: 4000 })
    expect(cols.rightbar).toBeLessThanOrEqual(900 - CENTER_MIN - SIDEBAR_COLLAPSED)
  })
})

describe('session browser — grouping, ordering, filtering', () => {
  const rows = [
    session({ id: 'a', cwd: 'C:/work/alpha', title: '修复构建', updated_at: 100 }),
    session({ id: 'b', cwd: 'C:/work/beta', title: '写文档', updated_at: 500 }),
    session({ id: 'c', cwd: 'C:/work/alpha', title: '跑测试', updated_at: 900 }),
    session({ id: 'd', cwd: 'C:/work/beta', title: '', snippet: '老的会话', updated_at: 0 }),
  ]

  test('recency wins, and a session without a timestamp sinks', () => {
    expect(sortByRecency(rows).map((r) => r.id)).toEqual(['c', 'b', 'a', 'd'])
  })

  test('groups are ordered by their most recent member, not alphabetically', () => {
    const groups = groupSessions(rows)
    expect(groups.map((g) => g.label)).toEqual(['alpha', 'beta'])
    expect(groups[0].sessions.map((s) => s.id)).toEqual(['c', 'a'])
  })

  test('the filter matches title, snippet and id, case-insensitively', () => {
    expect(filterSessions(rows, '文档').map((r) => r.id)).toEqual(['b'])
    expect(filterSessions(rows, 'ALPHA').map((r) => r.id)).toEqual(['a', 'c'])
    expect(filterSessions(rows, '  ').length).toBe(4)
  })

  test('a title-less row falls back to its id tail; a workspace to its last segment', () => {
    expect(sessionLabel(rows[3])).toContain('老的会话')
    expect(sessionLabel(session({ id: 'abcdef123456' }))).toBe('会话 123456')
    expect(workspaceLabel('D:\\Belong\\Case\\cell.cpp\\')).toBe('cell.cpp')
    expect(workspaceLabel('/home/me/proj')).toBe('proj')
    expect(workspaceLabel('')).toBe('其他')
  })

  test('the fold quota is the harness value', () => {
    expect(COLLAPSED_SESSION_LIMIT).toBe(5)
  })
})

describe('telemetry — turns, steps, tokens, cache', () => {
  const messages: UiMessage[] = [
    { key: '1', role: 'user', text: 'hi' },
    { key: '2', role: 'assistant', text: 'ok', tools: [{ id: 't1', name: 'read', args: '', status: 'ok', output: '' }] },
    { key: '3', role: 'user', text: 'again' },
    { key: '4', role: 'assistant', text: 'done', tools: [
      { id: 't2', name: 'exec', args: '', status: 'ok', output: '' },
      { id: 't3', name: 'edit', args: '', status: 'blocked', output: '' },
    ] },
  ]

  test('turns are user messages, steps are tool calls', () => {
    expect(transcriptStats(messages)).toEqual({ turns: 2, steps: 3 })
    expect(transcriptStats([])).toEqual({ turns: 0, steps: 0 })
  })

  test('usage totals sum every record, missing keys included', () => {
    const t = usageTotals({
      'openai:gpt-4o': { requests: 2, input_tokens: 100, output_tokens: 40, total_tokens: 140 },
      'anthropic:claude': { input_tokens: 50, total_tokens: 60, cached_tokens: 30, prompt_tokens: 80 },
    })
    expect(t.requests).toBe(2)
    expect(t.inputTokens).toBe(150)
    expect(t.outputTokens).toBe(40)
    expect(t.cachedTokens).toBe(30)
    expect(t.promptTokens).toBe(80)
  })

  test('the cache ratio is measured against the prompt total, never against a guess', () => {
    // OpenAI shape: input_tokens already includes the cached part
    expect(cacheHitRatio(usageTotals({ m: { input_tokens: 1000, cached_tokens: 900, prompt_tokens: 1000 } }))).toBeCloseTo(0.9, 5)
    // older records have no prompt total: fall back to input_tokens
    expect(cacheHitRatio(usageTotals({ m: { input_tokens: 1000, cached_tokens: 500 } }))).toBeCloseTo(0.5, 5)
    // nothing reported at all: a dash is honest, 0% is not
    expect(cacheHitRatio(usageTotals({ m: { input_tokens: 1000 } }))).toBe(0)
    expect(cacheHitRatio(usageTotals({}))).toBeUndefined()
    // the ratio can never exceed 1, whatever the provider reports
    expect(cacheHitRatio(usageTotals({ m: { input_tokens: 10, cached_tokens: 99, prompt_tokens: 10 } }))).toBe(1)
  })

  test('formatting: compact counts, percentages and the relative-age ladder', () => {
    expect(formatCompact(999)).toBe('999')
    expect(formatCompact(12_345)).toBe('12.3k')
    expect(formatCompact(161_000_000)).toBe('161M')
    expect(formatPercent(0.999)).toBe('99.9%')
    expect(formatPercent(undefined)).toBe('—')
    const now = Date.UTC(2026, 9, 16, 12, 0, 0)
    expect(relativeTime(now / 1000 - 5, now)).toBe('刚刚')
    expect(relativeTime(now / 1000 - 600, now)).toBe('10分钟')
    expect(relativeTime(now / 1000 - 7200, now)).toBe('2小时')
    expect(relativeTime(now / 1000 - 86400 * 3, now)).toBe('3天')
    expect(relativeTime(0, now)).toBe('')
  })
})

describe('trace ledger — transcript folded into turns', () => {
  test('a turn collects its reasoning, tools and answer in order', () => {
    const turns = buildTurns([
      { key: 'u1', role: 'user', text: 'do it' },
      {
        key: 'a1',
        role: 'assistant',
        text: 'done',
        reasoning: 'thinking',
        tools: [{ id: 't1', name: 'exec', args: '{"cmd":"ls"}', status: 'ok', output: 'x', seconds: 0.4 }],
      },
    ])
    expect(turns.length).toBe(1)
    expect(turns[0].prompt).toBe('do it')
    expect(turns[0].toolCount).toBe(1)
    expect(turns[0].steps.map((s) => s.kind)).toEqual(['reasoning', 'tool', 'answer'])
    expect(turns[0].steps[1].name).toBe('exec')
    expect(turnStatus(turns[0])).toBe('ok')
  })

  test('a resumed transcript that starts mid-turn still gets a row', () => {
    const turns = buildTurns([{ key: 'a1', role: 'assistant', text: 'orphan answer' }])
    expect(turns.length).toBe(1)
    expect(turns[0].prompt).toBe('')
    expect(turns[0].steps.length).toBe(1)
  })

  test('status prefers "still running", then "blocked", else ok', () => {
    const tool = (status: 'ok' | 'blocked' | 'running') => ({
      key: 'u', role: 'user' as const, text: 'x',
    })
    const t = (status: 'ok' | 'blocked' | 'running') => ({
      key: 't', role: 'assistant' as const, text: 'y',
      tools: [{ id: 'z', name: 'exec', args: '', status, output: '' }],
    })
    expect(turnStatus(buildTurns([tool('ok'), t('running')])[0])).toBe('running')
    expect(turnStatus(buildTurns([tool('ok'), t('blocked')])[0])).toBe('blocked')
    expect(turnStatus(buildTurns([tool('ok'), t('ok')])[0])).toBe('ok')
  })
})
