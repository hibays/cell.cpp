// Global keyboard shortcuts. Registered once in App.vue; the palette and the
// composer live inside the workspace, so the handlers go through the store.

import { onMounted, onUnmounted } from 'vue'
import { interrupt, newSession, resume, selectSession, store, toggleRightbar, toggleSidebar } from '../store'

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export function useShortcuts(): void {
  const onKey = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey

    // Ctrl/Cmd+K — command palette
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      store.paletteOpen = !store.paletteOpen
      return
    }

    // Ctrl/Cmd+N — new session
    if (mod && e.key.toLowerCase() === 'n' && store.phase === 'app') {
      e.preventDefault()
      void newSession()
      return
    }

    // Ctrl/Cmd+B — sidebar
    if (mod && e.key.toLowerCase() === 'b' && store.phase === 'app') {
      e.preventDefault()
      toggleSidebar()
      return
    }

    // Ctrl/Cmd+. — the right-hand panel (files / changes / logs)
    if (mod && e.key === '.' && store.phase === 'app') {
      e.preventDefault()
      toggleRightbar()
      return
    }

    // Esc — close palette / interrupt the running turn
    if (e.key === 'Escape') {
      if (store.paletteOpen) {
        store.paletteOpen = false
        return
      }
      if (store.streaming) {
        e.preventDefault()
        void interrupt()
      }
      return
    }

    // Ctrl/Cmd+Enter — resume an interrupted turn (from anywhere)
    if (mod && e.key === 'Enter' && store.lastInterrupted && !store.streaming && store.phase === 'app') {
      e.preventDefault()
      void resume()
      return
    }

    // 1..9 — jump to the nth session when not typing
    if (!isTypingTarget(e.target) && !mod && /^[1-9]$/.test(e.key) && store.phase === 'app') {
      const idx = Number(e.key) - 1
      const s = store.sessions[idx]
      if (s) void selectSession(s.id)
    }
  }

  onMounted(() => window.addEventListener('keydown', onKey))
  onUnmounted(() => window.removeEventListener('keydown', onKey))
}
