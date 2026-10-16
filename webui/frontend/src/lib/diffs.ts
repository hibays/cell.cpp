// What this session changed in one file, read off the transcript.
//
// The 改动 panel answers "which files"; this answers "what happened to *this*
// one" — the same derivation as lib/changes.ts, filtered to a path and parsed
// into rows. The diffs are the tools' own output: the kernel did the edit and
// reported it, and the viewer shows what it reported.

import { pathFromArgs } from './changes'
import { parseDiff, type ParsedDiff } from './diffView'
import type { UiMessage } from './transcript'

/** Tools whose result can carry a patch. */
const PATCH_TOOLS = new Set(['edit', 'write', 'apply_patch', 'create'])

export interface FileChange {
  /** The tool call id, so a row can be traced back to its card. */
  callId: string
  tool: string
  /** Parsed diff, or null when the tool reported a summary instead. */
  diff: ParsedDiff | null
  /** The tool's raw output, shown when there is no diff to render. */
  raw: string
  seconds?: number
}

/** Every change this session made to `path`, oldest first. */
export function fileChanges(messages: UiMessage[], path: string): FileChange[] {
  const out: FileChange[] = []
  for (const m of messages) {
    for (const tool of m.tools ?? []) {
      if (!PATCH_TOOLS.has(tool.name)) continue
      if (pathFromArgs(tool.args) !== path) continue
      out.push({
        callId: tool.id,
        tool: tool.name,
        diff: parseDiff(tool.output ?? ''),
        raw: tool.output ?? '',
        seconds: tool.seconds,
      })
    }
  }
  return out
}

/** Total lines added and removed across a file's changes. */
export function fileChangeTotals(changes: FileChange[]): { added: number; removed: number } {
  return changes.reduce(
    (acc, c) => ({ added: acc.added + (c.diff?.added ?? 0), removed: acc.removed + (c.diff?.removed ?? 0) }),
    { added: 0, removed: 0 },
  )
}
