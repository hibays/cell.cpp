// Composer layer tests: trigger tokens, the command table, mention ranking, the
// highlighter, the streaming block cache and the markdown extensions.
//
// All pure — no DOM, no kernel. The rules being pinned here come from the
// reference desktop harness (trigger at a word boundary, prefix before
// substring, frozen blocks while streaming, wide tables overflow), and a ported
// rule without a test drifts.
//
// Run: bun test tests/
import { describe, expect, test } from 'bun:test'
import { replaceToken, tokenAt } from '../src/lib/trigger'
import { argCandidates, findCommand, matchCommands } from '../src/lib/commands'
import { mentionCandidates } from '../src/lib/mentions'
import { grammarOf, highlightToHtml, MAX_HIGHLIGHT_LINE, tokenize } from '../src/lib/highlight'
import { createStreamRenderer, splitBlocks } from '../src/lib/streamMarkdown'
import { renderMarkdown } from '../src/lib/markdown'
import type { FileEntry, SessionSummary } from '../src/lib/api'

describe('trigger tokens', () => {
  test('a trigger only counts at a word boundary', () => {
    expect(tokenAt('你好 /com', 7, '/')).toEqual({ query: 'com', start: 3, end: 7 })
    // a path is not a command
    expect(tokenAt('读 src/main.cpp', 14, '/')).toBeNull()
    // an email is not a mention
    expect(tokenAt('me@example.com', 14, '@')).toBeNull()
  })

  test('whitespace ends the token, so the menu closes itself', () => {
    expect(tokenAt('/compact 已', 9, '/')).toBeNull()
    expect(tokenAt('@src/main.ts', 12, '@')).toEqual({ query: 'src/main.ts', start: 0, end: 12 })
  })

  test('replacing a token keeps the caret where the value ends', () => {
    const t = tokenAt('/sk', 3, '/')!
    expect(replaceToken('/sk', t, '/skill', { trailingSpace: true })).toEqual({
      text: '/skill ',
      caret: 7,
    })
    // mid-text replacement leaves the tail alone: the caret sits after the `a`,
    // so the token being replaced is exactly `@a`
    const t2 = tokenAt('前缀 @a 后缀', 5, '@')!
    expect(t2).toEqual({ query: 'a', start: 3, end: 5 })
    expect(replaceToken('前缀 @a 后缀', t2, 'src/a.ts', { trailingSpace: true }).text).toBe(
      '前缀 src/a.ts  后缀',
    )
  })
})

describe('the command table', () => {
  test('prefix match, shortest name first', () => {
    expect(matchCommands('co').map((c) => c.name)).toEqual(['/compact'])
    expect(matchCommands('').length).toBeGreaterThan(5)
    expect(matchCommands('nope')).toEqual([])
  })

  test('only commands the shell can actually run are listed', () => {
    // 🚧 in docs/RESTful.md — advertising them would be a lie
    for (const missing of ['/clear', '/reload', '/ins', '/save']) {
      expect(findCommand(missing)).toBeUndefined()
    }
    expect(findCommand('/compact')?.side).toBe('kernel')
    expect(findCommand('/export')?.side).toBe('shell')
  })

  test('argument candidates come from the live context', () => {
    const ctx = { skills: ['a', 'b'], levels: ['off', 'low'], sandboxes: ['read-only'] }
    expect(argCandidates({ kind: 'skill' }, ctx)).toEqual(['a', 'b'])
    expect(argCandidates({ kind: 'level' }, ctx)).toEqual(['off', 'low'])
    expect(argCandidates({ kind: 'toggle' }, ctx)).toEqual(['on', 'off'])
    expect(argCandidates({ kind: 'text' }, ctx)).toEqual([])
  })
})

describe('mention ranking', () => {
  const files: FileEntry[] = [
    { name: 'main.cpp', path: 'src/main.cpp', dir: false, size: 10, mtime: 0 },
    { name: 'src', path: 'src', dir: true, size: 0, mtime: 0 },
  ]
  const sessions = [{ id: 'abc1234567', cwd: '/p', messages: 1, snippet: '', title: 'main 相关排查', updated_at: 1 }] as SessionSummary[]
  const skills = [{ name: 'main-helper', description: 'x' }]

  test('files outrank sessions, which outrank skills', () => {
    const out = mentionCandidates('main', { files, sessions, skills })
    expect(out[0].kind).toBe('file')
    expect(out.map((c) => c.kind)).toEqual(['file', 'session', 'skill'])
  })

  test('a directory inserts a trailing slash so browsing continues', () => {
    const out = mentionCandidates('', { files })
    expect(out.find((c) => c.label === 'src/')?.insert).toBe('src/')
    expect(out.find((c) => c.label === 'main.cpp')?.insert).toBe('src/main.cpp')
  })

  test('an empty query lists everything, and the list is capped', () => {
    const out = mentionCandidates('', { files, sessions, skills, limit: 2 })
    expect(out.length).toBe(2)
  })
})

describe('highlighter', () => {
  test('fence info strings map to a grammar, unknown ones stay plain', () => {
    expect(grammarOf('typescript')).toBe('ts')
    expect(grammarOf('bash')).toBe('sh')
    expect(grammarOf('c++')).toBe('cpp')
    expect(grammarOf('brainfuck')).toBeNull()
    expect(grammarOf('')).toBeNull()
  })

  test('keywords, numbers, strings and calls are classified', () => {
    const kinds = tokenize('const n = 42; greet("hi")', 'ts').map((t) => `${t.kind}:${t.text}`)
    expect(kinds).toContain('keyword:const')
    expect(kinds).toContain('number:42')
    expect(kinds).toContain('string:"hi"')
    expect(kinds).toContain('func:greet')
  })

  test('a block comment stays open across lines', () => {
    const toks = tokenize('/* start\nstill inside */ let x = 1', 'ts')
    const comments = toks.filter((t) => t.kind === 'comment').map((t) => t.text)
    expect(comments).toEqual(['/* start', 'still inside */'])
    // …and the code after the comment closes is highlighted again
    expect(toks.some((t) => t.kind === 'keyword' && t.text === 'let')).toBe(true)
  })

  test('python and shell comments start with #', () => {
    expect(tokenize('# note', 'py')[0].kind).toBe('comment')
    expect(tokenize('echo hi # note', 'sh').at(-1)?.kind).toBe('comment')
  })

  test('pathological lines are emitted verbatim', () => {
    const long = `const a = "${'x'.repeat(MAX_HIGHLIGHT_LINE + 10)}"`
    const out = tokenize(long, 'ts')
    expect(out.length).toBe(1)
    expect(out[0].kind).toBe('plain')
  })

  test('output is escaped before it becomes markup', () => {
    const html = highlightToHtml('<script>alert(1)</script>', 'ts')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;')
  })
})

describe('streaming markdown', () => {
  test('a blank line inside a fence is not a block boundary', () => {
    const { blocks, tail } = splitBlocks('text\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\nafter')
    expect(blocks).toEqual(['text', '```ts\nconst a = 1\n\nconst b = 2\n```'])
    expect(tail).toBe('after')
  })

  test('completed blocks are rendered once, the tail every time', () => {
    let calls = 0
    const r = createStreamRenderer((md) => {
      calls++
      return `<${md}>`
    })
    expect(r.html('one\n\ntwo')).toBe('<one><two>')
    expect(calls).toBe(2)
    // the tail grew: only the tail is re-rendered
    expect(r.html('one\n\ntwo three')).toBe('<one><two three>')
    expect(calls).toBe(3)
    expect(r.cached()).toBe(1)
    // a new turn replaces the text: stale cache entries are dropped
    r.html('brand new')
    expect(r.cached()).toBe(0)
  })
})

describe('markdown extensions', () => {
  test('ordered and nested lists', () => {
    const html = renderMarkdown('1. 第一步\n2. 第二步\n  - 子项\n')
    expect(html).toContain('<ol>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>子项</li>')
  })

  test('task lists render as disabled checkboxes', () => {
    const html = renderMarkdown('- [x] 完成\n- [ ] 未完成')
    expect(html).toContain('checked')
    expect(html).toContain('<li class="task">')
  })

  test('a four-column table gets the wide treatment, a two-column one fills', () => {
    const wide = renderMarkdown('| a | b | c | d |\n| --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 |')
    expect(wide).toContain('md-table-wide')
    const narrow = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(narrow).toContain('md-table-fill')
    expect(narrow).not.toContain('md-table-wide')
  })

  test('code fences are highlighted and carry a copy button', () => {
    const html = renderMarkdown('```ts\nconst a = 1\n```')
    expect(html).toContain('data-copy')
    expect(html).toContain('tok-keyword')
    expect(html).toContain('data-lang="ts"')
  })

  test('an unterminated fence still renders (streaming does this constantly)', () => {
    const html = renderMarkdown('```py\ndef f():\n')
    expect(html).toContain('<pre class="code"')
    expect(html).toContain('keyword')
  })

  test('raw HTML stays literal text', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })
})
