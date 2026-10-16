<script setup lang="ts">
// A floating option list, shared by every composer palette (commands, mentions,
// the file picker, the model / fence / think selectors).
//
// One component instead of five: they differ in their items, not in their
// behaviour — a filterable list, keyboard-driven, dismissed on outside click.
// The parent owns the items and the "what happens on pick"; this owns the look
// and the arrow/enter/escape handling.
import { computed, onMounted, onUnmounted, ref } from 'vue'

export interface MenuItem {
  key: string
  label: string
  hint?: string
  meta?: string
  /** A section label: rendered, not selectable. */
  header?: boolean
}

const props = defineProps<{
  items: MenuItem[]
  title?: string
  /** Where the panel sits relative to its anchor. */
  placement?: 'up' | 'down'
}>()
const emit = defineEmits<{ pick: [key: string]; close: [] }>()

const active = ref(0)
const selectable = computed(() => props.items.filter((i) => !i.header))

// keep the cursor on a row that exists: the list shrinks as the user types
function clamp(): void {
  const n = selectable.value.length
  active.value = n === 0 ? -1 : Math.max(0, Math.min(active.value, n - 1))
}

function move(delta: number): void {
  const n = selectable.value.length
  if (n === 0) return
  active.value = (active.value + delta + n) % n
}

function pick(): void {
  const item = selectable.value[active.value]
  if (item) emit('pick', item.key)
}

const flatIndex = (key: string): number => selectable.value.findIndex((i) => i.key === key)

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter' && e.key !== 'Tab' && e.key !== 'Escape')
    return
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') emit('close')
  else if (e.key === 'Enter' || e.key === 'Tab') pick()
  else move(e.key === 'ArrowDown' ? 1 : -1)
}

function onDocClick(e: MouseEvent): void {
  const el = panel.value
  if (el && !el.contains(e.target as Node)) emit('close')
}

const panel = ref<HTMLElement | null>(null)
// capture phase: the textarea would otherwise swallow arrows and enter
onMounted(() => {
  window.addEventListener('keydown', onKey, true)
  document.addEventListener('mousedown', onDocClick)
  window.addEventListener('resize', () => emit('close'))
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKey, true)
  document.removeEventListener('mousedown', onDocClick)
})

defineExpose({ move, clamp, pick, active, flatIndex })
clamp()
</script>

<template>
  <div ref="panel" class="menu" :class="placement === 'down' ? 'down' : 'up'">
    <p v-if="title" class="title">{{ title }}</p>
    <p v-if="!items.length" class="empty">没有匹配项</p>
    <template v-for="it in items" :key="it.key">
      <p v-if="it.header" class="group">{{ it.label }}</p>
      <button
        v-else
        class="row"
        :class="{ on: flatIndex(it.key) === active }"
        type="button"
        @mouseenter="active = flatIndex(it.key)"
        @mousedown.prevent="emit('pick', it.key)"
      >
        <span class="label">{{ it.label }}</span>
        <span v-if="it.hint" class="hint">{{ it.hint }}</span>
        <span v-if="it.meta" class="meta">{{ it.meta }}</span>
      </button>
    </template>
    <p class="foot"><kbd>↑</kbd><kbd>↓</kbd> 选择 · <kbd>Enter</kbd> 确认 · <kbd>Esc</kbd> 关闭</p>
  </div>
</template>

<style scoped>
.menu {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 40;
  max-height: 320px;
  overflow: auto;
  padding: 6px;
  border: 1px solid var(--cell-alias-line);
  border-radius: var(--cell-radius-md);
  background: var(--cell-alias-menu-surface);
  backdrop-filter: var(--cell-alias-menu-backdrop);
  box-shadow: var(--cell-alias-shadow);
}

.menu.up {
  bottom: calc(100% + 6px);
}

.menu.down {
  top: calc(100% + 6px);
}

.title,
.group {
  margin: 4px 8px 2px;
  font-size: var(--cell-font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--cell-alias-ink-faint);
}

.row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 100%;
  border: 0;
  border-radius: var(--cell-radius-sm);
  background: none;
  color: var(--cell-alias-ink);
  font-size: var(--cell-font-size-sm);
  padding: 5px 8px;
  text-align: left;
}

.row.on {
  background: var(--cell-alias-accent-soft);
}

.label {
  flex: 0 0 auto;
  font-family: var(--cell-mono);
}

.hint {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--cell-alias-ink-dim);
  font-size: var(--cell-font-size-xs);
}

.meta {
  flex: 0 0 auto;
  color: var(--cell-alias-ink-faint);
  font-size: var(--cell-font-size-xs);
}

.empty,
.foot {
  margin: 6px 8px;
  color: var(--cell-alias-ink-faint);
  font-size: var(--cell-font-size-xs);
}
</style>
