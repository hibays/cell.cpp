// Rendering blocks for tool output.
//
// A unified diff and a shell transcript deserve better than one grey <pre>: the
// diff wants add/remove colouring and a +N/-M summary, the transcript wants its
// exit code surfaced instead of buried on the last line. Classification is pure
// so it can be tested without a DOM.

export type DiffLineKind = 'add' | 'del' | 'ctx' | 'hunk' | 'meta'

export interface DiffLine {
  kind: DiffLineKind
  text: string
}

export interface ParsedDiff {
  lines: DiffLine[]
  stats: { added: number; removed: number }
}

export type RenderKind = 'diff' | 'terminal' | 'text'

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * Parse a unified diff. Returns null when the text is not a diff, so callers can
 * fall back to plain rendering rather than guessing.
 */
export function parseUnifiedDiff(text: unknown): ParsedDiff | null {
  const s = str(text)
  if (!s) return null
  const raw = s.split('\n')

  const hasHunk = raw.some((l) => l.startsWith('@@'))
  const hasFileHeaders = raw.some((l) => l.startsWith('--- ')) && raw.some((l) => l.startsWith('+++ '))
  if (!hasHunk && !hasFileHeaders) return null

  let added = 0
  let removed = 0
  const lines: DiffLine[] = raw.map((line) => {
    // file headers are metadata, not changes — counting them would report
    // one phantom +1/-1 on every diff
    if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      return { kind: 'meta', text: line }
    }
    if (line.startsWith('@@')) return { kind: 'hunk', text: line }
    if (line.startsWith('+')) {
      added += 1
      return { kind: 'add', text: line }
    }
    if (line.startsWith('-')) {
      removed += 1
      return { kind: 'del', text: line }
    }
    if (
      line.startsWith('new file') ||
      line.startsWith('deleted file') ||
      line.startsWith('similarity index') ||
      line.startsWith('rename ') ||
      line.startsWith('\\ No newline')
    ) {
      return { kind: 'meta', text: line }
    }
    return { kind: 'ctx', text: line }
  })

  return { lines, stats: { added, removed } }
}

/** The shell tool appends `exitcode=N`; take the last one. */
export function exitCodeOf(text: unknown): number | null {
  const s = str(text)
  if (!s) return null
  let found: number | null = null
  for (const m of s.matchAll(/^exitcode=(-?\d+)\s*$/gm)) {
    found = Number(m[1])
  }
  return found !== null && Number.isFinite(found) ? found : null
}

export function renderKindOf(text: unknown): RenderKind {
  const s = str(text)
  if (parseUnifiedDiff(s)) return 'diff'
  if (exitCodeOf(s) !== null) return 'terminal'
  return 'text'
}
