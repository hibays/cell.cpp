/// <reference types="vite/client" />

/** Native bridge exposed by cellui.cpp (webui_bind). All calls return promises. */
export interface CellNative {
  cell_hello(): Promise<string>
  cell_bootstrap(): Promise<string>
  cell_export_session(sessionId: string, outPath?: string): Promise<string>
  cell_export_batch(sessionIds: string[]): Promise<string>
  cell_export_all(): Promise<string>
  cell_reveal(path: string): Promise<string>
  cell_open_external(url: string): Promise<string>
  cell_native_capabilities(): Promise<string>
  cell_notify(text: string): Promise<string>
}

declare global {
  interface Window {
    cell: CellNative
  }
}

export {}
