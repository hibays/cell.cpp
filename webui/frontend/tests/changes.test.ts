// Changed-files derivation tests.
//
// The 改动 panel says which files the agent has been editing, and it says it from
// the transcript rather than from a new endpoint — which makes these the only
// tests standing between a plausible-looking list and an honest one.
//
// Run: bun test tests/
import { describe, expect, test } from 'bun:test'
import { changedFiles, pathFromArgs } from '../src/lib/changes'
import type { UiMessage } from '../src/lib/transcript'
import type { UiToolCall } from '../src/lib/transcript'

const tool = (name: string, args: string): UiToolCall => ({
  id: `${name}-1`,
  name,
  args,
  status: 'ok',
  output: '',
})

const msg = (tools: UiToolCall[]): UiMessage => ({ key: 'k', role: 'assistant', text: '', tools })

describe('changed files', () => {
  test('only mutating tools count — reads are not changes', () => {
    const out = changedFiles([msg([tool('read', '{"path":"src/a.ts"}'), tool('rg', '{"pattern":"x"}')])])
    expect(out).toEqual([])
  })

  test('writes and edits accumulate per path, most-edited first', () => {
    const out = changedFiles([
      msg([tool('edit', '{"path":"cell.cpp","search":"a","content":"b"}')]),
      msg([tool('write', '{"path":"docs/x.md","content":"hi"}')]),
      msg([tool('edit', '{"path":"cell.cpp","search":"c","content":"d"}')]),
    ])
    expect(out.map((c) => c.path)).toEqual(['cell.cpp', 'docs/x.md'])
    expect(out[0].edits).toBe(2)
    expect(out[0].tools).toContain('edit')
  })

  test('the path is read from whichever field the tool uses', () => {
    expect(pathFromArgs('{"file_path":"a/b.py"}')).toBe('a/b.py')
    expect(pathFromArgs('{"filename":"x.go"}')).toBe('x.go')
    expect(pathFromArgs('{"path":"  trimmed.ts  "}')).toBe('trimmed.ts')
  })

  test('truncated or non-JSON arguments still yield something plausible', () => {
    // old transcripts contain clipped argument strings; a bare path is the
    // shape to look for, and "no path" is a valid answer
    expect(pathFromArgs('{"path":"src/deep/file.ts"')).toBe('src/deep/file.ts')
    expect(pathFromArgs('')).toBeUndefined()
    expect(pathFromArgs('{"note":"nothing here"}')).toBeUndefined()
  })

  test('a path-less mutating call is skipped rather than listed as ""', () => {
    const out = changedFiles([msg([tool('write', 'not json at all')])])
    expect(out).toEqual([])
  })

  test('the same tool twice on one path counts as two edits, not two files', () => {
    const out = changedFiles([msg([tool('write', '{"path":"a.txt"}'), tool('write', '{"path":"a.txt"}')])])
    expect(out.length).toBe(1)
    expect(out[0].edits).toBe(2)
    expect(out[0].tools).toEqual(['write'])
  })
})
