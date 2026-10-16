// Pointer-drag handle for the shell's column separators.
//
// One update per animation frame, not one per pointermove (the reference
// harness's DragHandle rule: `frame.current ??= requestAnimationFrame(…)`).
// Pointer capture is used so the gesture survives leaving the 6px handle, and
// the final position is always flushed on release — a dropped frame must never
// leave the width stale.

import { onUnmounted, ref } from 'vue'

export interface DragHandle {
  dragging: ReturnType<typeof ref<boolean>>
  onPointerDown: (e: PointerEvent) => void
}

export function useDragHandle(onDrag: (total: number) => void): DragHandle {
  const dragging = ref(false)
  let start = 0
  let pending = 0
  let frame: number | null = null

  function flush(): void {
    if (frame === null) return
    cancelAnimationFrame(frame)
    frame = null
    onDrag(pending)
  }

  function schedule(): void {
    if (frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      onDrag(pending)
    })
  }

  function move(e: PointerEvent): void {
    pending = e.clientX - start
    schedule()
  }

  function stop(): void {
    window.removeEventListener('pointermove', move)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    if (!dragging.value) return
    dragging.value = false
    flush()
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return
    e.preventDefault()
    dragging.value = true
    start = e.clientX
    pending = 0
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
    window.addEventListener('pointercancel', stop, { once: true })
  }

  onUnmounted(() => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
  })

  return { dragging, onPointerDown }
}
