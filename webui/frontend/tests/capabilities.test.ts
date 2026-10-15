// Agent capability summary.
//
// The panel must describe what the agent can *actually* do, which today is
// derived from three sources: /v1/config (switches), /v1/skills (inventory) and
// /v1/usages (spend). Teamwork, compaction and skills are all live now
// (docs/RESTful.md §3.9), so no row may claim anything is still "planned".
//
// Run: bun test tests/
import { describe, expect, test } from 'bun:test'
import { summarizeCapabilities, toRows } from '../src/lib/capabilities'

const base = {
  tools: true,
  max_threads: 4,
  teamwork_max_children: 2,
  compact_auto: true,
  compact_provider: '',
  compact_model: '',
  current_provider: 'openai',
  current_model: 'gpt',
}

describe('capability summary', () => {
  test('compaction falls back to the current provider/model when unset', () => {
    const s = summarizeCapabilities({ config: base })
    expect(s.compaction.provider).toBe('openai')
    expect(s.compaction.model).toBe('gpt')
  })

  test('an explicit compaction target wins over the fallback', () => {
    const s = summarizeCapabilities({
      config: { ...base, compact_provider: 'deepseek', compact_model: 'reasoner' },
    })
    expect(s.compaction.provider).toBe('deepseek')
    expect(s.compaction.model).toBe('reasoner')
  })

  test('teamwork is enabled only when it can actually spawn children', () => {
    expect(summarizeCapabilities({ config: { ...base, teamwork_max_children: 0 } }).teamworkEnabled).toBe(false)
    expect(summarizeCapabilities({ config: { ...base, teamwork_max_children: 3 } }).teamworkChildren).toBe(3)
    expect(summarizeCapabilities({ config: { ...base, teamwork_max_children: 3 } }).teamworkEnabled).toBe(true)
  })

  test('skills are reported in a stable order', () => {
    const s = summarizeCapabilities({
      config: base,
      skills: {
        skills: [
          { name: 'zeta', description: 'z', file: 'z.md' },
          { name: 'alpha', description: 'a', file: 'a.md' },
        ],
      },
    })
    expect(s.skills.map((x) => x.name)).toEqual(['alpha', 'zeta'])
  })

  test('usage totals are summed across models', () => {
    const s = summarizeCapabilities({
      config: base,
      usage: { models: { a: { tok_in: 10, tok_out: 5 }, b: { tok_in: 3, tok_out: 2 } } },
    })
    expect(s.usage.tokIn).toBe(13)
    expect(s.usage.tokOut).toBe(7)
    expect(s.usage.models).toBe(2)
  })

  test('degraded states name the real limitation', () => {
    const off = summarizeCapabilities({ config: { ...base, tools: false } })
    expect(off.degraded.some((d) => d.includes('工具调用已关闭'))).toBe(true)

    const noCompact = summarizeCapabilities({ config: { ...base, compact_auto: false } })
    expect(noCompact.degraded.some((d) => d.includes('自动压缩已关闭'))).toBe(true)

    expect(summarizeCapabilities({ config: base }).degraded).toEqual([])
  })

  test('a missing config never throws and reports itself as unknown', () => {
    const s = summarizeCapabilities({ config: null, skills: null, usage: null })
    expect(s.skills).toEqual([])
    expect(s.usage.tokIn).toBe(0)
    expect(s.degraded.some((d) => d.includes('配置未加载'))).toBe(true)
  })

  test('rows carry a label and a value for the panel', () => {
    const rows = toRows(summarizeCapabilities({ config: base }))
    expect(rows.length).toBeGreaterThan(3)
    for (const r of rows) {
      expect(typeof r.label).toBe('string')
      expect(typeof r.value).toBe('string')
    }
  })

  test('the compaction row no longer claims a trigger is planned', () => {
    const rows = toRows(summarizeCapabilities({ config: { ...base, compact_auto: true } }))
    const compact = rows.find((r) => r.label === '自动压缩')
    expect(compact).toBeDefined()
    expect(compact!.hint).toBeUndefined()
  })

  test('the teamwork row points at the real control surface, never "planned"', () => {
    const rows = toRows(summarizeCapabilities({ config: { ...base, teamwork_max_children: 2 } }))
    const tw = rows.find((r) => r.label === '子代理上限')
    expect(tw).toBeDefined()
    expect(tw!.hint).toBeDefined()
    expect(tw!.hint).toContain('协作任务')
    expect(tw!.hint).not.toContain('规划中')

    // a disabled teamwork setting has nothing to point at
    const off = toRows(summarizeCapabilities({ config: { ...base, teamwork_max_children: 0 } }))
    expect(off.find((r) => r.label === '子代理上限')!.hint).toBeUndefined()
  })

  test('no capability row claims anything is still planned', () => {
    const rows = toRows(summarizeCapabilities({ config: base }))
    for (const r of rows) expect(r.hint ?? '').not.toContain('规划中')
  })
})
