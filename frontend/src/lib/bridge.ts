// Wrappers around the native bridge (cellui.cpp). Every helper degrades
// gracefully when the bridge is absent (e.g. running `bun run dev` in a plain
// browser, where the native layer does not exist).

import { parseJson, type ApiError } from './api'

export interface ExportResult {
  ok?: boolean
  id?: string
  path?: string
  error?: string
}

function hasBridge(): boolean {
  return typeof window !== 'undefined' && typeof window.cell?.cell_bootstrap === 'function'
}

async function call<T>(fn: () => Promise<string>): Promise<T> {
  return parseJson<T>(await fn()) as T
}

export const bridge = {
  available: hasBridge,

  async exportSession(sessionId: string, outPath?: string): Promise<ExportResult> {
    if (!hasBridge()) return { error: 'native bridge unavailable (dev mode)' }
    return call<ExportResult>(() => window.cell.cell_export_session(sessionId, outPath))
  },

  async exportBatch(sessionIds: string[]): Promise<ExportResult[]> {
    if (!hasBridge()) return sessionIds.map((id) => ({ id, error: 'native bridge unavailable (dev mode)' }))
    return call<ExportResult[]>(() => window.cell.cell_export_batch(sessionIds))
  },

  async exportAll(): Promise<ExportResult[]> {
    if (!hasBridge()) return [{ error: 'native bridge unavailable (dev mode)' }]
    return call<ExportResult[]>(() => window.cell.cell_export_all())
  },

  async reveal(path: string): Promise<void> {
    if (!hasBridge()) return
    await window.cell.cell_reveal(path)
  },

  async openExternal(url: string): Promise<void> {
    if (!hasBridge()) {
      window.open(url, '_blank', 'noopener')
      return
    }
    await window.cell.cell_open_external(url)
  },

  async capabilities(): Promise<Record<string, unknown>> {
    if (!hasBridge()) return { shell: 'browser' }
    return call<Record<string, unknown>>(() => window.cell.cell_native_capabilities())
  },

  /** In-app toast for now; the native placeholder reports it is not implemented. */
  async notify(text: string): Promise<void> {
    if (!hasBridge()) return
    try {
      await window.cell.cell_notify(text)
    } catch {
      /* native notifications are a placeholder; the web toast is the real one */
    }
  },
}

export function errorMessage(e: unknown): string {
  const err = e as Partial<ApiError> & { message?: string }
  return err?.message ?? String(e)
}
