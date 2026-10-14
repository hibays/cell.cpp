// Error taxonomy for the shell.
//
// Rule ported from the reference desktop harness: **route on `code`, never by
// parsing `message`**. Message text is provider- and locale-dependent, so any UI
// decision (retry? re-auth? tell the user to compact?) has to come from a stable
// code. Every failure entering the UI — HTTP status, SSE error frame, or a plain
// network throw — is funnelled through classifyError() so the rest of the app
// only ever sees a CellErrorView.

export const CELL_ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'not_found',
  'bad_request',
  'payload_too_large',
  'provider_unreachable',
  'provider_rejected',
  'rate_limit',
  'context_window',
  'tool_timeout',
  'tool_blocked',
  'approval_denied',
  'approval_timeout',
  'turn_error',
  'capture_failed',
  'shutting_down',
  'transport',
  'aborted',
  'internal',
  'unknown',
] as const

export type CellErrorCode = (typeof CELL_ERROR_CODES)[number]

export type CellErrorCategory =
  | 'auth'
  | 'request'
  | 'provider'
  | 'budget'
  | 'context'
  | 'approval'
  | 'tool'
  | 'transport'
  | 'lifecycle'
  | 'internal'
  | 'unknown'

/** What the UI should offer once this error is on screen. */
export type CellErrorAction =
  | 'retry'
  | 'reconnect'
  | 'authenticate'
  | 'configure-provider'
  | 'compact'
  | 'none'

export interface CellErrorView {
  code: CellErrorCode
  category: CellErrorCategory
  retryable: boolean
  title: string
  hint: string
  action: CellErrorAction
  /** The original code when it did not match the taxonomy (for logging only). */
  raw?: string
}

interface Row {
  category: CellErrorCategory
  retryable: boolean
  title: string
  hint: string
  action: CellErrorAction
}

const TABLE: Record<CellErrorCode, Row> = {
  unauthorized: {
    category: 'auth',
    retryable: false,
    title: 'Not authenticated',
    hint: 'The kernel rejected the request token — restart the shell so it re-issues one.',
    action: 'authenticate',
  },
  forbidden: {
    category: 'auth',
    retryable: false,
    title: 'Not permitted',
    hint: 'The current fence blocks this action. Widen the sandbox or approve it.',
    action: 'none',
  },
  not_found: {
    category: 'request',
    retryable: false,
    title: 'Not found',
    hint: 'The session or resource no longer exists.',
    action: 'none',
  },
  bad_request: {
    category: 'request',
    retryable: false,
    title: 'Bad request',
    hint: 'The kernel rejected the payload; this is a shell bug, not a provider problem.',
    action: 'none',
  },
  payload_too_large: {
    category: 'request',
    retryable: false,
    title: 'Payload too large',
    hint: 'The request exceeded the kernel limit — shorten the input.',
    action: 'none',
  },
  provider_unreachable: {
    category: 'provider',
    retryable: true,
    title: 'Provider unreachable',
    hint: 'The model endpoint did not answer. Check network/proxy, then retry.',
    action: 'retry',
  },
  provider_rejected: {
    category: 'provider',
    retryable: false,
    title: 'Provider rejected the request',
    hint: 'Usually an invalid key or an unsupported model — check provider settings.',
    action: 'configure-provider',
  },
  rate_limit: {
    category: 'budget',
    retryable: true,
    title: 'Rate limited',
    hint: 'The provider throttled this call. Wait a moment and retry.',
    action: 'retry',
  },
  context_window: {
    category: 'context',
    retryable: false,
    title: 'Context window exceeded',
    hint: 'This session is too large for the model — compact it or start a new session.',
    action: 'compact',
  },
  tool_timeout: {
    category: 'tool',
    retryable: true,
    title: 'Tool timed out',
    hint: 'The command or tool did not finish in time. Retry, or narrow it.',
    action: 'retry',
  },
  tool_blocked: {
    category: 'tool',
    retryable: false,
    title: 'Blocked by the sandbox',
    hint: 'The current fence denies this operation — widen the sandbox to allow it.',
    action: 'none',
  },
  approval_denied: {
    category: 'approval',
    retryable: false,
    title: 'Denied',
    hint: 'You declined this action, so it did not run.',
    action: 'none',
  },
  approval_timeout: {
    category: 'approval',
    retryable: true,
    title: 'Approval timed out',
    hint: 'No decision arrived in time, so the action was skipped.',
    action: 'retry',
  },
  turn_error: {
    category: 'provider',
    retryable: true,
    title: 'Turn failed',
    hint: 'The agent could not complete this turn. Retry, or switch provider/model.',
    action: 'retry',
  },
  capture_failed: {
    category: 'internal',
    retryable: false,
    title: 'Output capture failed',
    hint: 'The kernel could not capture tool output for this turn.',
    action: 'none',
  },
  shutting_down: {
    category: 'lifecycle',
    retryable: false,
    title: 'Kernel is stopping',
    hint: 'The agent service is shutting down.',
    action: 'reconnect',
  },
  transport: {
    category: 'transport',
    retryable: true,
    title: 'Cannot reach the kernel',
    hint: 'The in-process service is unreachable — it may still be starting up.',
    action: 'reconnect',
  },
  aborted: {
    category: 'lifecycle',
    retryable: false,
    title: 'Cancelled',
    hint: 'This request was cancelled.',
    action: 'none',
  },
  internal: {
    category: 'internal',
    retryable: true,
    title: 'Kernel error',
    hint: 'The agent hit an internal error. Retry; if it repeats, check the kernel log.',
    action: 'retry',
  },
  unknown: {
    category: 'unknown',
    retryable: false,
    title: 'Something went wrong',
    hint: 'Unclassified failure — see the kernel log for details.',
    action: 'none',
  },
}

function statusToCode(status: number): CellErrorCode {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not_found'
  if (status === 408 || status === 504) return 'tool_timeout'
  if (status === 413) return 'payload_too_large'
  if (status === 429) return 'rate_limit'
  if (status >= 500) return 'internal'
  if (status >= 400) return 'bad_request'
  return 'unknown'
}

function view(code: CellErrorCode, raw?: string): CellErrorView {
  const row = TABLE[code] ?? TABLE.unknown
  return { code, ...row, ...(raw ? { raw } : {}) }
}

function isKnown(code: string): code is CellErrorCode {
  return (CELL_ERROR_CODES as readonly string[]).includes(code)
}

/**
 * Classify anything that can fail on the way to the kernel into a CellErrorView.
 * Never throws: an unclassifiable input degrades to `unknown` so a failure can
 * never take down the renderer that is trying to report it.
 */
export function classifyError(e: unknown): CellErrorView {
  // user cancellation is a lifecycle event, not a failure to present as an error
  if (e && typeof e === 'object' && (e as { name?: string }).name === 'AbortError') {
    return view('aborted')
  }
  if (e && typeof e === 'object') {
    const o = e as { status?: unknown; code?: unknown }
    if (typeof o.status === 'number') {
      const code = statusToCode(o.status)
      const raw = typeof o.code === 'string' && !isKnown(o.code) ? o.code : undefined
      return view(code, raw)
    }
    if (typeof o.code === 'string') {
      return isKnown(o.code) ? view(o.code) : view('unknown', o.code)
    }
  }
  // a thrown Error with no status/code could not reach the kernel at all
  if (e instanceof Error) return view('transport')
  return view('unknown')
}

/** One-line rendering for a toast / status bar. */
export function describeError(v: CellErrorView): string {
  return `${v.code}: ${v.title} — ${v.hint}`
}
