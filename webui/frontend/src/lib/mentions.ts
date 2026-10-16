// `@` mention candidates: files in the working directory, sessions, skills.
//
// The ranking is deliberate: a file the user is looking at beats another
// session, which beats a skill. Within each group it is a prefix match first,
// then a substring match — the same "narrow before broad" rule the reference
// harness's lexicon uses.

import type { FileEntry } from './api'
import type { SessionSummary } from './api'
import { sessionLabel } from './sessions'

export type MentionKind = 'file' | 'session' | 'skill'

export interface MentionCandidate {
  kind: MentionKind
  /** What the row shows. */
  label: string
  /** What gets inserted into the prompt (a path, or `@session:<id>`-style ref). */
  insert: string
  /** Secondary text: the directory, the workspace, the description. */
  hint?: string
}

const RANK: Record<MentionKind, number> = { file: 0, session: 1, skill: 2 }

export function mentionCandidates(
  query: string,
  ctx: {
    files?: FileEntry[]
    sessions?: SessionSummary[]
    skills?: { name: string; description?: string }[]
    limit?: number
  },
): MentionCandidate[] {
  const q = query.trim().toLowerCase()
  const out: MentionCandidate[] = []

  for (const f of ctx.files ?? []) {
    if (!q || f.name.toLowerCase().includes(q)) {
      out.push({
        kind: 'file',
        label: f.name + (f.dir ? '/' : ''),
        insert: f.dir ? `${f.path}/` : f.path,
        hint: f.dir ? '目录' : f.size !== undefined && f.size >= 0 ? `${f.size} 字节` : '',
      })
    }
  }
  for (const s of ctx.sessions ?? []) {
    const label = sessionLabel(s)
    if (!q || label.toLowerCase().includes(q) || s.id.includes(q)) {
      out.push({ kind: 'session', label, insert: `@会话 ${s.id}`, hint: s.cwd })
    }
  }
  for (const sk of ctx.skills ?? []) {
    if (!q || sk.name.toLowerCase().includes(q)) {
      out.push({ kind: 'skill', label: sk.name, insert: `@技能 ${sk.name}`, hint: sk.description ?? '' })
    }
  }

  const score = (c: MentionCandidate): number => {
    const l = c.label.toLowerCase()
    const prefix = q && l.startsWith(q) ? 0 : 1
    return RANK[c.kind] * 10 + prefix
  }
  return out.toSorted((a, b) => score(a) - score(b)).slice(0, ctx.limit ?? 40)
}
