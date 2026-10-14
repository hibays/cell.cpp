// Connection state machine with bounded exponential backoff.
//
// The shell talks to an in-process kernel that can be slow to appear (bootstrap,
// restart, window reload). Rather than sprinkling ad-hoc retries through the UI,
// recovery lives in one state machine: connected / connecting / disconnected,
// with a backoff ladder that resets on success and is capped so a permanently
// dead kernel does not spin.

export type ConnectionState = 'connected' | 'connecting' | 'disconnected'

export interface RecoveryConfig {
  backoffBaseMs: number
  backoffFactor: number
  backoffMaxMs: number
}

export interface Connection {
  readonly state: ConnectionState
  /** Consecutive failed attempts; reset on every successful connect. */
  readonly attempt: number
  /** Reason for the last disconnect, if any. */
  readonly lastError: string | null
  /** Subscribe to state changes; returns an unsubscribe function. */
  onStateChange(fn: (s: ConnectionState) => void): () => void
  markConnected(): void
  markDisconnected(reason?: string): void
  /** Immediate reconnect: skip whatever backoff was pending. */
  reconnect(): void
  /** Record a failed attempt and return the delay to wait before retrying. */
  scheduleRetry(): number
}

const DEFAULTS: RecoveryConfig = {
  backoffBaseMs: 500,
  backoffFactor: 2,
  backoffMaxMs: 10_000,
}

export function createConnection(opts?: Partial<RecoveryConfig>): Connection {
  const cfg = { ...DEFAULTS, ...opts }
  let state: ConnectionState = 'disconnected'
  let attempt = 0
  let lastError: string | null = null
  const listeners = new Set<(s: ConnectionState) => void>()

  const set = (next: ConnectionState) => {
    if (next === state) return
    state = next
    for (const fn of listeners) fn(state)
  }

  return {
    get state() {
      return state
    },
    get attempt() {
      return attempt
    },
    get lastError() {
      return lastError
    },
    onStateChange(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    markConnected() {
      attempt = 0
      lastError = null
      set('connected')
    },
    markDisconnected(reason?: string) {
      lastError = reason ?? null
      set('disconnected')
    },
    reconnect() {
      attempt = 0
      set('connecting')
    },
    scheduleRetry() {
      attempt += 1
      set('connecting')
      const raw = cfg.backoffBaseMs * Math.pow(cfg.backoffFactor, attempt - 1)
      return Math.min(cfg.backoffMaxMs, Math.round(raw))
    },
  }
}
