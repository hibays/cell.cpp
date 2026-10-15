// Rendering blocks for tool output.
//
// A unified diff and a shell transcript deserve different treatment from a blob
// of text: the diff wants add/remove colouring and a +N/-M summary, the
// transcript wants its exit code surfaced. Classification is pure so it is
// testable without a DOM.
//
// Run: bun test tests/
import { describe, expect, test } from 'bun:test'
import { exitCodeOf, parseUnifiedDiff, renderKindOf } from '../src/lib/blocks'

const DIFF = [
  'diff --git a/a.txt b/a.txt',
  'index 111..222 100644',
  '--- a/a.txt',
  '+++ b/a.txt',
  '@@ -1,3 +1,3 @@',
  ' unchanged',
  '-gone',
  '+added',
  '+also',
].join('\n')

describe('unified diff parsing', () => {
  test('classifies every line and counts the changes', () => {
    const d = parseUnifiedDiff(DIFF)
    expect(d).not.toBeNull()
    expect(d!.stats).toEqual({ added: 2, removed: 1 })
    const kinds = d!.lines.map((l) => l.kind)
    expect(kinds[0]).toBe('meta') // diff --git
    expect(kinds[4]).toBe('hunk') // @@
    expect(kinds[5]).toBe('ctx')
    expect(kinds[6]).toBe('del')
    expect(kinds[7]).toBe('add')
  })

  test('a git diff without a hunk header is still recognised', () => {
    const d = parseUnifiedDiff('--- a/x\n+++ b/x\n-old\n+new\n')
    expect(d!.stats).toEqual({ added: 1, removed: 1 })
  })

  test('plain output is not a diff', () => {
    expect(parseUnifiedDiff('hello\nworld')).toBeNull()
    expect(parseUnifiedDiff('')).toBeNull()
    expect(parseUnifiedDiff(undefined as unknown as string)).toBeNull()
  })

  test('the +++/--- file headers are not counted as changes', () => {
    const d = parseUnifiedDiff(DIFF)!
    expect(d.lines.filter((l) => l.kind === 'del')).toHaveLength(1)
    expect(d.lines.filter((l) => l.kind === 'add')).toHaveLength(2)
  })
})

describe('shell transcript', () => {
  test('the exit code is extracted from the trailing marker', () => {
    expect(exitCodeOf('built ok\nexitcode=0')).toBe(0)
    expect(exitCodeOf('boom\nexitcode=1')).toBe(1)
    expect(exitCodeOf('trap\nexitcode=127')).toBe(127)
  })

  test('a missing or malformed marker yields null, not NaN', () => {
    expect(exitCodeOf('no marker')).toBeNull()
    expect(exitCodeOf('exitcode=')).toBeNull()
    expect(exitCodeOf('exitcode=abc')).toBeNull()
    expect(exitCodeOf(undefined as unknown as string)).toBeNull()
  })
})

describe('render kind selection', () => {
  test('a diff wins over everything else', () => {
    expect(renderKindOf(DIFF)).toBe('diff')
  })

  test('an exit marker means a terminal transcript', () => {
    expect(renderKindOf('$ ls\nfile\nexitcode=0')).toBe('terminal')
  })

  test('anything else is plain text', () => {
    expect(renderKindOf('just some words')).toBe('text')
    expect(renderKindOf('')).toBe('text')
  })
})
