// Unified-diff parsing for the review strip in the file viewer.
//
// What is rendered is what the tools reported: an `edit` result carries a unified
// diff, a `write` result may carry one for a new file and a plain summary
// otherwise. Nothing here computes a diff by comparing file states — the kernel
// has the real before/after and this only reads what it said.

export type DiffRowKind = 'meta' | 'ctx' | 'add' | 'del' | 'other'

export interface DiffRow {
  kind: DiffRowKind
  text: string
  /** Line numbers in the old / new file, when the row carries content. */
  oldNo?: number
  newNo?: number
}

export interface ParsedDiff {
  rows: DiffRow[]
  added: number
  removed: number
  hunks: number
  /** The input was cut at the row cap. */
  truncated: boolean
}

/** Rows kept per diff; a long patch is for grepping, not for reading whole. */
export const MAX_DIFF_ROWS = 600

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/**
 * Parse a unified diff. Returns null when the text is not one — a summary like
 * "updated 1 line" is not a diff, and pretending otherwise would render noise.
 */
export function parseDiff(raw: string, cap = MAX_DIFF_ROWS): ParsedDiff | null {
  if (!raw) return null
  const lines = raw.split('\n')
  if (!lines.some((l) => l.startsWith('@@') || (l.startsWith('--- ') && lines.some((m) => m.startsWith('+++ ')))))
    return null

  const rows: DiffRow[] = []
  let added = 0
  let removed = 0
  let hunks = 0
  let oldNo = 0
  let newNo = 0
  let inHunk = false
  let truncated = false

  for (const [i, line] of lines.entries()) {
    // the final newline of a patch splits into an empty trailing element; it is
    // not a context line, and rendering it would show a phantom blank row
    if (i === lines.length - 1 && line === '')
      continue
    if (rows.length >= cap) {
      truncated = true
      break
    }
    const hunk = line.match(HUNK)
    if (hunk) {
      inHunk = true
      hunks++
      oldNo = Number(hunk[1])
      newNo = Number(hunk[3])
      rows.push({ kind: 'meta', text: line })
      continue
    }
    if (!inHunk) {
      // --- a/x, +++ b/x and anything else before the first hunk
      if (line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('diff ') || line.startsWith('index '))
        rows.push({ kind: 'meta', text: line })
      else if (line.trim())
        rows.push({ kind: 'other', text: line })
      continue
    }
    if (line.startsWith('+')) {
      rows.push({ kind: 'add', text: line.slice(1), newNo })
      newNo++
      added++
    } else if (line.startsWith('-')) {
      rows.push({ kind: 'del', text: line.slice(1), oldNo })
      oldNo++
      removed++
    } else if (line.startsWith('\\')) {
      rows.push({ kind: 'meta', text: line }) // "\ No newline at end of file"
    } else {
      rows.push({ kind: 'ctx', text: line.slice(1), oldNo, newNo })
      oldNo++
      newNo++
    }
  }
  return { rows, added, removed, hunks, truncated }
}

/** "3 个 hunk · +12 −4"，the shape a diff header shows. */
export function diffSummary(d: ParsedDiff): string {
  const bits = [`${d.hunks} 个 hunk`, `+${d.added}`, `−${d.removed}`]
  if (d.truncated) bits.push('已截断')
  return bits.join(' · ')
}
