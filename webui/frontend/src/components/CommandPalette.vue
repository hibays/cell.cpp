<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import {
  enterApp,
  interrupt,
  newSession,
  openPalette,
  resume,
  selectSession,
  store,
  toggleSidebar,
} from '../store'
import { sessionTitle } from '../lib/format'

const emit = defineEmits<{ (e: 'open-export'): void; (e: 'open-settings'): void }>()

const q = ref('')
const sel = ref(0)
const list = ref<HTMLUListElement | null>(null)

interface Item {
  id: string
  label: string
  hint: string
  run: () => void | Promise<void>
}

const items = computed<Item[]>(() => {
  const base: Item[] = [
    { id: 'new', label: '新建会话', hint: 'Ctrl+N', run: () => newSession() },
    { id: 'sidebar', label: '切换侧栏', hint: 'Ctrl+B', run: () => toggleSidebar() },
  ]
  if (store.streaming) base.push({ id: 'stop', label: '中断当前生成', hint: 'Esc', run: () => interrupt() })
  if (store.lastInterrupted && !store.streaming)
    base.push({ id: 'resume', label: '继续上次中断的回合', hint: 'Ctrl+Enter', run: () => resume() })
  base.push({
    id: 'export',
    label: '导出当前会话为 HTML',
    hint: 'native bridge',
    run: () => emit('open-export'),
  })
  base.push({ id: 'settings', label: '打开设置', hint: '', run: () => emit('open-settings') })
  if (store.phase === 'landing')
    base.push({ id: 'enter', label: '进入工作区', hint: '', run: () => enterApp() })

  const query = q.value.trim().toLowerCase()
  const sessions: Item[] = store.sessions.map((s) => ({
    id: `s:${s.id}`,
    label: sessionTitle(s.snippet, s.id.slice(-8)),
    hint: `${s.messages} 条 · ${s.cwd}`,
    run: () => {
      void selectSession(s.id)
    },
  }))
  const all = [...base, ...sessions]
  return query
    ? all.filter((i) => i.label.toLowerCase().includes(query) || i.hint.toLowerCase().includes(query))
    : all
})

function choose(item: Item): void {
  openPalette(false)
  void item.run()
}

async function move(delta: number): Promise<void> {
  sel.value = Math.min(Math.max(sel.value + delta, 0), items.value.length - 1)
  await nextTick()
  list.value?.children[sel.value]?.scrollIntoView({ block: 'nearest' })
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    openPalette(false)
    return
  }
  if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
    e.preventDefault()
    void move(1)
  }
  if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
    e.preventDefault()
    void move(-1)
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    const item = items.value[sel.value]
    if (item) choose(item)
  }
}
</script>

<template>
  <div v-if="store.paletteOpen" class="backdrop" @click.self="openPalette(false)">
    <div class="palette">
      <input v-model="q" class="q" placeholder="搜索命令或会话…" @keydown="onKeydown" />
      <ul ref="list" class="list">
        <li
          v-for="(item, i) in items"
          :key="item.id"
          :class="{ sel: i === sel }"
          @click="choose(item)"
          @mouseenter="sel = i"
        >
          <span class="label">{{ item.label }}</span>
          <span class="hint">{{ item.hint }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(3, 7, 18, 0.6);
  backdrop-filter: blur(3px);
  display: grid;
  place-items: start center;
  padding-top: 14vh;
  z-index: 80;
  animation: cell-fade-in 0.12s ease both;
}

.palette {
  width: min(560px, 92vw);
  background: var(--bg-elev);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}

.q {
  width: 100%;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: transparent;
  outline: none;
  padding: 14px 16px;
  font-size: 15px;
}

.list {
  list-style: none;
  margin: 0;
  padding: 6px;
  max-height: 46vh;
  overflow: auto;
}

li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

li.sel {
  background: var(--accent-soft);
}

.label {
  font-size: 13.5px;
}

.hint {
  margin-left: auto;
  color: var(--ink-faint);
  font-size: 11.5px;
  font-family: var(--mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 45%;
}
</style>
