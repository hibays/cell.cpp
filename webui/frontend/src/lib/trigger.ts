// Composer trigger tokens: the `/command` and `@mention` under the caret.
//
// Pure string arithmetic so the palettes can be driven without a DOM: the
// composer asks "is there a trigger token at the caret", gets a range back, and
// replacing it with the chosen value is the same function in reverse.

export interface TriggerToken {
  /** What the user typed after the trigger character. */
  query: string
  /** Index of the trigger character itself. */
  start: number
  /** Caret position the token ends at. */
  end: number
}

function isBoundary(ch: string | undefined): boolean {
  return ch === undefined || ch === ' ' || ch === '\n' || ch === '\t'
}

/**
 * The trigger token ending at `caret`, or null.
 *
 * A trigger only counts at a word boundary (`/` mid-path is not a command, and
 * an email address must not open the mention menu), and never spans whitespace,
 * so typing past the token closes the menu on its own.
 */
export function tokenAt(text: string, caret: number, trigger: string): TriggerToken | null {
  if (caret < 0 || caret > text.length) return null
  const before = text.slice(0, caret)
  const at = before.lastIndexOf(trigger)
  if (at < 0) return null
  if (!isBoundary(before[at - 1])) return null
  const query = before.slice(at + 1)
  if (/[\s]/.test(query)) return null
  return { query, start: at, end: caret }
}

/** Replace `token` with `value` (a mention keeps its trailing space for chaining). */
export function replaceToken(
  text: string,
  token: TriggerToken,
  value: string,
  opts: { trailingSpace?: boolean } = {},
): { text: string; caret: number } {
  const insert = value + (opts.trailingSpace ? ' ' : '')
  const next = text.slice(0, token.start) + insert + text.slice(token.end)
  return { text: next, caret: token.start + insert.length }
}
