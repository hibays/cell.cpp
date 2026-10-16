// Streaming markdown: render the finished blocks once, re-render only the tail.
//
// Re-rendering the whole message on every token is what makes a long answer feel
// slow (the reference harness solves it with a fixed-block cache plus rAF
// publication; `lib/scheduler.ts` already does the publication half). The
// complication is fences: a blank line inside ``` is *not* a block boundary, so
// the splitter has to track fence state — otherwise a code block would be torn
// in half and both halves would render wrong.

/** Split markdown into completed blocks and the still-growing tail. */
export function splitBlocks(text: string): { blocks: string[]; tail: string } {
  const lines = text.split('\n')
  const blocks: string[] = []
  let current: string[] = []
  let fence: string | null = null

  for (const line of lines) {
    const trimmed = line.trimStart()
    const marker = trimmed.startsWith('```') ? '```' : trimmed.startsWith('~~~') ? '~~~' : null
    if (marker) {
      if (fence === marker) fence = null
      else if (fence === null) fence = marker
      current.push(line)
      continue
    }
    const blank = line.trim() === ''
    if (blank && fence === null) {
      if (current.length) {
        blocks.push(current.join('\n'))
        current = []
      }
      continue
    }
    current.push(line)
  }
  return { blocks, tail: current.join('\n') }
}

export interface StreamRenderer {
  /** Rendered HTML for the text so far. Completed blocks are cached by index. */
  html(text: string): string
  /** Forget the cache (a new turn, a new session). */
  reset(): void
  /** How many blocks are currently frozen — for the tests. */
  cached(): number
}

export function createStreamRenderer(render: (md: string) => string): StreamRenderer {
  const cache = new Map<number, string>()
  return {
    html(text: string): string {
      const { blocks, tail } = splitBlocks(text)
      // a block that is no longer in the list means the text was replaced
      // (new turn), not appended to: drop stale entries. Deleting while walking
      // a Map's keys is safe (the entry is simply not visited again).
      for (const key of cache.keys()) if (key >= blocks.length) cache.delete(key)
      const parts: string[] = []
      for (let i = 0; i < blocks.length; i++) {
        let html = cache.get(i)
        if (html === undefined) {
          html = render(blocks[i])
          cache.set(i, html)
        }
        parts.push(html)
      }
      if (tail) parts.push(render(tail))
      return parts.join('')
    },
    reset(): void {
      cache.clear()
    },
    cached(): number {
      return cache.size
    },
  }
}
