// Wrappers around the native bridge (cellui.cpp). Every helper degrades
// gracefully when the bridge is absent (e.g. running `bun run dev` in a plain
// browser, where the native layer does not exist).

import { parseJson, resolveNative, type ApiError } from './api'

export interface ExportResult {
  ok?: boolean
  id?: string
  path?: string
  error?: string
}

function hasBridge(): boolean {
  // webui binds globals (window.cell_bootstrap); the window.cell.* namespace
  // is the documented contract — resolveNative accepts both forms.
  return resolveNative('cell_hello') !== undefined
}

async function call<T>(fn: () => Promise<string>): Promise<T> {
  return parseJson<T>(await fn()) as T
}

export const bridge = {
  available: hasBridge,

  async exportSession(sessionId: string, outPath?: string): Promise<ExportResult> {
    if (!hasBridge()) return { error: 'native bridge unavailable (dev mode)' }
    return call<ExportResult>(() => resolveNative('cell_export_session')!(sessionId, outPath))
  },

  async exportBatch(sessionIds: string[]): Promise<ExportResult[]> {
    if (!hasBridge()) return sessionIds.map((id) => ({ id, error: 'native bridge unavailable (dev mode)' }))
    return call<ExportResult[]>(() => resolveNative('cell_export_batch')!(sessionIds))
  },

  async exportAll(): Promise<ExportResult[]> {
    if (!hasBridge()) return [{ error: 'native bridge unavailable (dev mode)' }]
    return call<ExportResult[]>(() => resolveNative('cell_export_all')!())
  },

  async reveal(path: string): Promise<void> {
    if (!hasBridge()) return
    const raw = await resolveNative('cell_reveal')!(path)
    const r = parseJson<{ ok?: boolean; error?: string }>(raw ?? '')
    if (r && r.ok === false) throw new Error(r.error ?? 'the file manager did not open')
  },

  async openExternal(url: string): Promise<void> {
    if (!hasBridge()) {
      window.open(url, '_blank', 'noopener')
      return
    }
    const raw = await resolveNative('cell_open_external')!(url)
    const r = parseJson<{ ok?: boolean; error?: string }>(raw ?? '')
    if (r && r.ok === false) throw new Error(r.error ?? 'no application accepted the url')
  },

  async capabilities(): Promise<Record<string, unknown>> {
    if (!hasBridge()) return { shell: 'browser' }
    return call<Record<string, unknown>>(() => resolveNative('cell_native_capabilities')!())
  },

  /** In-app toast for now; the native placeholder reports it is not implemented. */
  async notify(text: string): Promise<void> {
    if (!hasBridge()) return
    try {
      await resolveNative('cell_notify')!(text)
    } catch {
      /* native notifications are a placeholder; the web toast is the real one */
    }
  },
}

export function errorMessage(e: unknown): string {
  const err = e as Partial<ApiError> & { message?: string }
  return err?.message ?? String(e)
}
