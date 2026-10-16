// Reading an approval record without reading a wall of JSON.
//
// The audit line holds the tool and its raw arguments, which for `exec` is a
// command line and for `edit` is a search/replace pair. This picks the part a
// person wants to see, classifies the risk with the *same* rule the live
// approval card uses, and counts the decisions.

export interface ApprovalRecord {
  id: string
  session: string
  tool: string
  args: string
  decision: string
  reason: string
  at: number
}

/** Keys worth showing first, in the order a person reads them. */
const INTERESTING = ['cmd', 'path', 'file', 'filename', 'pattern', 'query', 'url', 'name']

/**
 * One line out of a tool's arguments: the most telling field if the args parse
 * as JSON, otherwise the raw text clipped. Never throws on malformed JSON —
 * audit lines outlive the shapes they were written with.
 */
export function summarizeArgs(args: string, max = 120): string {
  const raw = (args ?? '').trim()
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    for (const key of INTERESTING) {
      const v = parsed[key]
      if (typeof v === 'string' && v.trim()) return clip(v.trim(), max)
    }
    // nothing telling: the first string value, or the keys themselves
    for (const v of Object.values(parsed)) if (typeof v === 'string' && v.trim()) return clip(v.trim(), max)
    return clip(Object.keys(parsed).join(', '), max)
  } catch {
    return clip(raw, max)
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * The risk rule the live approval card applies, in one place so the history and
 * the card cannot drift apart.
 */
export function riskOf(text: string): 'high' | 'normal' {
  return /rm\s+-rf|chmod|sudo|git\s+(push|reset)|:\(\)\{|mkfs|del\s+\/[sf]/.test(text) ? 'high' : 'normal'
}

export function decisionTone(decision: string): 'ok' | 'bad' {
  return decision === 'allow' ? 'ok' : 'bad'
}

export function decisionLabel(decision: string): string {
  return decision === 'allow' ? '允许' : decision === 'deny' ? '拒绝' : decision
}

export interface ApprovalStats {
  total: number
  allowed: number
  denied: number
  highRisk: number
}

export function approvalStats(rows: ApprovalRecord[]): ApprovalStats {
  let allowed = 0
  let denied = 0
  let highRisk = 0
  for (const r of rows) {
    if (r.decision === 'allow') allowed++
    else denied++
    if (riskOf(`${r.tool} ${summarizeArgs(r.args)}`) === 'high') highRisk++
  }
  return { total: rows.length, allowed, denied, highRisk }
}