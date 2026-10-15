// Transcript normalisation — the UI's outermost untrusted boundary.
//
// The kernel returns the raw provider transcript, so this parser sees whatever
// OpenAI- and Anthropic-shaped records the agent persisted, including records
// written by an older build. It must never throw, never invent content, and
// must keep keys stable across re-normalisation (the transcript is reloaded at
// the end of every turn, and changing keys throws away the whole list's DOM).
//
// Run: bun test tests/
import { describe, expect, test } from 'bun:test'
import { normalizeTranscript } from '../src/lib/transcript'

describe('transcript normalisation', () => {
  test('a tool result attaches to its call and completes it', () => {
    const out = normalizeTranscript([
      {
        role: 'assistant',
        content: 'let me look',
        tool_calls: [{ id: 'c1', function: { name: 'read', arguments: '{"path":"a"}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'file body' },
    ])
    expect(out).toHaveLength(1)
    const tool = out[0].tools?.[0]
    expect(tool?.name).toBe('read')
    expect(tool?.status).toBe('ok')
    expect(tool?.output).toBe('file body')
  })

  test('results match by id when present, and in order when not', () => {
    const out = normalizeTranscript([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'a', function: { name: 'one', arguments: '{}' } },
          { id: 'b', function: { name: 'two', arguments: '{}' } },
        ],
      },
      { role: 'tool', content: 'first' },
      { role: 'tool', content: 'second' },
    ])
    expect(out[0].tools?.[0].output).toBe('first')
    expect(out[0].tools?.[1].output).toBe('second')
    expect(out[0].tools?.every((t) => t.status === 'ok')).toBe(true)
  })

  test('a tool call with no result stays running', () => {
    const out = normalizeTranscript([
      { role: 'assistant', content: '', tool_calls: [{ id: 'x', function: { name: 'exec', arguments: '{}' } }] },
    ])
    expect(out[0].tools?.[0].status).toBe('running')
  })

  test('an orphan tool result is dropped rather than attaching to nothing', () => {
    const out = normalizeTranscript([{ role: 'tool', content: 'orphan' }])
    expect(out).toEqual([])
  })

  test('non-string tool output is stringified, not lost', () => {
    const out = normalizeTranscript([
      { role: 'assistant', content: '', tool_calls: [{ id: 'j', function: { name: 'x', arguments: '{}' } }] },
      { role: 'tool', content: { ok: true, lines: 3 } },
    ])
    expect(out[0].tools?.[0].output).toContain('"ok":true')
  })

  test('Anthropic content blocks are read, including tool_use', () => {
    const out = normalizeTranscript([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'thinking out loud' },
          { type: 'tool_use', id: 'tu1', name: 'grep', input: { q: 'x' } },
        ],
      },
    ])
    expect(out[0].text).toBe('thinking out loud')
    expect(out[0].tools?.[0].name).toBe('grep')
    expect(out[0].tools?.[0].args).toContain('"q":"x"')
  })

  test('openai input_text / output_text blocks are read too', () => {
    const out = normalizeTranscript([
      { role: 'user', content: [{ type: 'input_text', text: 'ask' }] },
      { role: 'assistant', content: [{ type: 'output_text', text: 'answer' }] },
    ])
    expect(out[0].text).toBe('ask')
    expect(out[1].text).toBe('answer')
  })

  test('reasoning is picked up from either spelling', () => {
    const a = normalizeTranscript([{ role: 'assistant', content: 'x', reasoning_content: 'r1' }])
    const b = normalizeTranscript([{ role: 'assistant', content: 'x', reasoning: 'r2' }])
    expect(a[0].reasoning).toBe('r1')
    expect(b[0].reasoning).toBe('r2')
  })

  test('empty and unknown records are skipped, never rendered as blanks', () => {
    const out = normalizeTranscript([
      { role: 'assistant', content: '' },
      { role: 'system', content: 'folded away' },
      { role: 'nonsense', content: 'x' },
      { role: 'user', content: '   ' },
    ])
    expect(out).toEqual([])
  })

  test('malformed input never throws', () => {
    const junk: unknown[] = [null, undefined, 42, 'string', [], [null], { role: 42 }, { role: 'assistant' }]
    expect(() => normalizeTranscript(junk)).not.toThrow()
    expect(normalizeTranscript(junk)).toEqual([])
  })

  test('keys are stable across re-normalisation of the same transcript', () => {
    const raw = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]
    const first = normalizeTranscript(raw).map((m) => m.key)
    const second = normalizeTranscript(raw).map((m) => m.key)
    // the transcript is reloaded at the end of every turn; keys that drifted
    // would throw away and rebuild the entire list each time
    expect(second).toEqual(first)
  })

  test('keys stay unique when a message is appended', () => {
    const base = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]
    const before = normalizeTranscript(base).map((m) => m.key)
    const after = normalizeTranscript([...base, { role: 'user', content: 'again' }]).map((m) => m.key)
    expect(new Set(after).size).toBe(after.length)
    expect(after.slice(0, before.length)).toEqual(before)
  })
})
