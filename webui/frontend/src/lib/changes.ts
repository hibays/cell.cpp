// What this session has touched.
//
// The shell's 改动 panel answers "which files has the agent been editing", and
// the transcript already says so: every mutating tool call carries a path. This
// derives the list client-side rather than asking the kernel for a new endpoint —
// the answer is a fold over data the shell already has, and a fold is testable.

import type { UiMessage } from './transcript'

/** Tools whose argument names a file they change. `read` is deliberately absent. */
const MUTATING = new Set(['write', 'edit', 'create', 'apply_patch', 'remove', 'mkdir', 'move', 'copy'])

export interface ChangedFile {
  path: string
  /** How many mutating calls named it. */
  edits: number
  /** Tool names seen for it, in first-seen order. */
  tools: string[]
}

/** Best-effort path out of a tool's raw argument string. */
export function pathFromArgs(args: string): string | undefined {
  const raw = (args ?? '').trim()
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    for (const key of ['path', 'file', 'filename', 'file_path', 'path1', 'source']) {
      const v = parsed[key]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return undefined
  } catch {
    // not JSON (truncated args are common in old transcripts): fall back to the
    // first path-shaped token, which is how the CLI's own resume previews do it
    const m = raw.match(/[^\s"',{}:]+[\\/][^\s"',{}:]+|\b[\w.-]+\.[A-Za-z0-9]{1,8}\b/)
    return m ? m[0] : undefined
  }
}

/** Files this session has written to or edited, most-edited first. */
export function changedFiles(messages: UiMessage[]): ChangedFile[] {
  const byPath = new Map<string, ChangedFile>()
  for (const m of messages) {
    for (const tool of m.tools ?? []) {
      const name = tool.name
      if (!MUTATING.has(name)) continue
      const path = pathFromArgs(tool.args)
      if (!path) continue
      const hit = byPath.get(path)
      if (hit) {
        hit.edits++
        if (!hit.tools.includes(name)) hit.tools.push(name)
      } else {
        byPath.set(path, { path, edits: 1, tools: [name] })
      }
    }
  }
  return [...byPath.values()].toSorted((a, b) => b.edits - a.edits || a.path.localeCompare(b.path))
}
