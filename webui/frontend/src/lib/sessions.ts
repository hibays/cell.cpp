// Session list derivation — pure functions, no Vue.
//
// The reference harness keeps its workspace browser honest by deriving grouping,
// ordering and filtering in `ui-workspace/src/client/rows/tree.ts` instead of
// inside the 1.4k-line component; the two numbers below come from that file's
// sibling `WorkspaceBrowser.tsx`.

import type { SessionSummary } from './api'

/** Debounce before a keystroke reaches the filter (harness value). */
export const SEARCH_DEBOUNCE_MS = 250
/** Rows shown per workspace before the group folds (harness value). */
export const COLLAPSED_SESSION_LIMIT = 5

export interface SessionGroup {
  /** Stable identity for fold state: the working directory, or '' for the loose group. */
  key: string
  cwd: string
  label: string
  sessions: SessionSummary[]
}

/** Most recent first; sessions without a timestamp sink to the bottom. */
export function sortByRecency(list: SessionSummary[]): SessionSummary[] {
  return list.toSorted((a, b) => {
    const at = a.updated_at || 0
    const bt = b.updated_at || 0
    if (at !== bt) return bt - at
    return b.id.localeCompare(a.id)
  })
}

/** Case-insensitive match over the title, the snippet, the id and the workspace path. */
export function filterSessions(list: SessionSummary[], query: string): SessionSummary[] {
  const q = query.trim().toLowerCase()
  if (!q) return list
  return list.filter((s) =>
    `${s.title ?? ''} ${s.snippet ?? ''} ${s.cwd ?? ''} ${s.id}`.toLowerCase().includes(q),
  )
}

/** Row label: the title the kernel derived from the first user turn, else the id tail. */
export function sessionLabel(s: SessionSummary): string {
  const t = (s.title || s.snippet || '').trim().replace(/\s+/g, ' ')
  if (t) return t.length > 60 ? `${t.slice(0, 59)}…` : t
  return `会话 ${s.id.slice(-6)}`
}

/** Workspace label: the directory's last segment, home abbreviated. */
export function workspaceLabel(cwd: string): string {
  const p = (cwd || '').replace(/[\\/]+$/, '')
  if (!p) return '其他'
  const seg = p.split(/[\\/]/).filter(Boolean)
  return seg[seg.length - 1] || p
}

/**
 * Newest-first sessions, optionally filtered, grouped by working directory.
 *
 * Groups are ordered by their most recent session, so the workspace you are
 * working in floats to the top — the same rule the harness applies. Sessions
 * whose directory is unknown collect in an "其他" group at the end.
 */
export function groupSessions(
  list: SessionSummary[],
  opts: { query?: string } = {},
): SessionGroup[] {
  const rows = sortByRecency(filterSessions(list, opts.query ?? ''))
  const byKey = new Map<string, SessionGroup>()
  for (const s of rows) {
    const key = s.cwd || ''
    let g = byKey.get(key)
    if (!g) {
      g = { key, cwd: s.cwd, label: workspaceLabel(s.cwd), sessions: [] }
      byKey.set(key, g)
    }
    g.sessions.push(s)
  }
  const groups = [...byKey.values()]
  // newest group first, and the loose group never wins a tie against a real
  // workspace ("其他" belongs at the bottom)
  return groups.toSorted((a, b) => {
    const byAge = (b.sessions[0]?.updated_at ?? 0) - (a.sessions[0]?.updated_at ?? 0)
    if (byAge !== 0) return byAge
    if (!a.cwd !== !b.cwd) return a.cwd ? -1 : 1
    return 0
  })
}
