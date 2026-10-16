// Diff parsing and per-file change derivation.
//
// The rule under test is the honesty one: a summary that is not a diff must not
// be rendered as one, and the line numbers the viewer shows have to come from the
// hunk headers rather than from a guess.
//
// Run: bun test tests/
import { describe, expect, test } from 'bun:test'
import { diffSummary, parseDiff } from '../src/lib/diffView'
import { fileChangeTotals, fileChanges } from '../src/lib/diffs'
import type { UiMessage, UiToolCall } from '../src/lib/transcript'

const PATCH = `--- a/cell.cpp
+++ b/cell.cpp
@@ -245,3 +245,4 @@ static void f()
 ctx
-gone
+added
+more
`

describe('parseDiff', () => {
  test('counts adds, removes and hunks, and numbers rows from the header', () => {
    const d = parseDiff(PATCH)!
    expect(d.added).toBe(2)
    expect(d.removed).toBe(1)
    expect(d.hunks).toBe(1)
    const ctx = d.rows.find((r) => r.kind === 'ctx')!
    expect(ctx.oldNo).toBe(245)
    expect(ctx.text).toBe('ctx')
    const del = d.rows.find((r) => r.kind === 'del')!
    expect(del.text).toBe('gone')
    expect(del.oldNo).toBe(246)
    const adds = d.rows.filter((r) => r.kind === 'add')
    expect(adds.map((r) => r.text)).toEqual(['added', 'more'])
    expect(adds[0].newNo).toBe(246)
  })

  test('a summary is not a diff', () => {
    expect(parseDiff('updated 1 line')).toBeNull()
    expect(parseDiff('')).toBeNull()
    expect(parseDiff('[tool failed] file not found')).toBeNull()
  })

  test('the no-newline marker is metadata, not content', () => {
    const d = parseDiff('@@ -1,1 +1,1 @@\n-a\n+b\n\\ No newline at end of file\n')!
    expect(d.added).toBe(1)
    expect(d.removed).toBe(1)
    expect(d.rows.at(-1)?.kind).toBe('meta')
  })

  test('rows are capped and the cap is announced', () => {
    const many = ['@@ -1,0 +1,50 @@', ...Array.from({ length: 50 }, (_, i) => `+line ${i}`)].join('\n')
    const d = parseDiff(many, 10)!
    expect(d.rows.length).toBe(10)
    expect(d.truncated).toBe(true)
    expect(diffSummary(d)).toContain('已截断')
  })

  test('the summary reads as a diff header', () => {
    expect(diffSummary(parseDiff(PATCH)!)).toBe('1 个 hunk · +2 · −1')
  })
})

describe('fileChanges', () => {
  const tool = (name: string, args: string, output: string, id = name): UiToolCall => ({
    id,
    name,
    args,
    status: 'ok',
    output,
  })
  const msg = (tools: UiToolCall[]): UiMessage => ({ key: 'k', role: 'assistant', text: '', tools })

  test('only mutating tools, only the asked-for path', () => {
    const messages = [
      msg([
        tool('read', '{"path":"cell.cpp"}', 'file contents'),
        tool('edit', '{"path":"docs/x.md","search":"a","content":"b"}', PATCH, 'e1'),
        tool('edit', '{"path":"cell.cpp","search":"x","content":"y"}', PATCH, 'e2'),
      ]),
    ]
    const changes = fileChanges(messages, 'cell.cpp')
    expect(changes.length).toBe(1)
    expect(changes[0].callId).toBe('e2')
    expect(changes[0].diff?.added).toBe(2)
  })

  test('a tool that reported a summary keeps its raw text instead of a fake diff', () => {
    const changes = fileChanges([msg([tool('write', '{"path":"a.txt"}', 'created 3 lines')])], 'a.txt')
    expect(changes[0].diff).toBeNull()
    expect(changes[0].raw).toBe('created 3 lines')
  })

  test('totals sum across the changes of one file', () => {
    const messages = [
      msg([tool('edit', '{"path":"a.txt"}', PATCH, '1'), tool('edit', '{"path":"a.txt"}', PATCH, '2')]),
    ]
    const totals = fileChangeTotals(fileChanges(messages, 'a.txt'))
    expect(totals).toEqual({ added: 4, removed: 2 })
  })

  test('a file nothing touched has no changes', () => {
    expect(fileChanges([msg([tool('read', '{"path":"a.txt"}', 'x')])], 'a.txt')).toEqual([])
  })
})
