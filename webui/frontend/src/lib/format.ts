// Small formatting helpers shared across the UI.

export function formatTime(ts: number | string | undefined): string {
  if (ts === undefined) return ''
  const ms = typeof ts === 'number' ? ts * 1000 : Date.parse(ts)
  if (!Number.isFinite(ms)) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function formatDateTime(ts: number | undefined): string {
  if (ts === undefined) return ''
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatNumber(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function formatBytes(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '—'
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const m = Math.floor(seconds / 60)
  return `${m}m ${Math.round(seconds % 60)}s`
}

/** Session title: the first user message, trimmed — the human label a GUI needs. */
export function sessionTitle(snippet: string | undefined, fallback: string): string {
  const s = (snippet ?? '').trim().replace(/\s+/g, ' ')
  if (!s) return fallback.slice(0, 18)
  return s.length > 40 ? `${s.slice(0, 39)}…` : s
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

export interface Clipped {
  text: string
  /** True when the view differs from the full output. */
  cut: boolean
  /** True when what is shown is the end of the output rather than the start. */
  fromEnd: boolean
}

/**
 * Clip tool output for display.
 *
 * Collapsed: show the tail, because that is where a failing command explains
 * itself. Expanded: still cap the DOM — a multi-megabyte <pre> freezes the
 * renderer, and a frozen UI hides the error the user opened the card to read.
 */
export function clipOutput(
  text: string | undefined,
  opts: { tail: number; cap: number; expand: boolean },
): Clipped {
  const s = text ?? ''
  if (!s) return { text: '', cut: false, fromEnd: false }
  if (opts.expand) {
    return s.length > opts.cap
      ? { text: s.slice(0, opts.cap), cut: true, fromEnd: false }
      : { text: s, cut: false, fromEnd: false }
  }
  return s.length > opts.tail
    ? { text: s.slice(-opts.tail), cut: true, fromEnd: true }
    : { text: s, cut: false, fromEnd: false }
}
