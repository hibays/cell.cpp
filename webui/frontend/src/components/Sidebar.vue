<script setup lang="ts">
// Sidebar: brand, new session, workspace groups, settings.
//
// Structure follows the reference GUI: a workspace section whose sessions are
// grouped by directory, each row labelled with its title and relative age, with
// a search that filters across all groups and a per-group fold quota so a busy
// workspace cannot push everything else off screen.
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  newSession,
  setArchived,
  toggleArchived,
  openSettings,
  selectSession,
  setSessionQuery,
  store,
  toggleSidebar,
  toggleTheme,
} from '../store'
import { COLLAPSED_SESSION_LIMIT, SEARCH_DEBOUNCE_MS, groupSessions, sessionLabel } from '../lib/sessions'
import { relativeTime } from '../lib/format'
import type { SessionSummary } from '../lib/api'

defineEmits<{ export: [] }>()

const searchOpen = ref(false)
const rawQuery = ref('')
const expanded = ref<Record<string, boolean>>({})
let debounce: number | undefined

// The filter itself is debounced (harness value, 250 ms): typing must not re-sort
// the list under the cursor on every keystroke.
function onQueryInput(): void {
  window.clearTimeout(debounce)
  debounce = window.setTimeout(() => setSessionQuery(rawQuery.value), SEARCH_DEBOUNCE_MS)
}

const groups = computed(() => groupSessions(store.sessions, { query: store.sessionQuery }))

function rowsOf(key: string, sessions: SessionSummary[]): SessionSummary[] {
  return expanded.value[key] ? sessions : sessions.slice(0, COLLAPSED_SESSION_LIMIT)
}

function hiddenCount(key: string, total: number): number {
  return expanded.value[key] ? 0 : Math.max(0, total - COLLAPSED_SESSION_LIMIT)
}

function toggleGroup(key: string): void {
  expanded.value = { ...expanded.value, [key]: !expanded.value[key] }
}

const total = computed(() => store.sessions.length)
const shown = computed(() => groups.value.reduce((n, g) => n + g.sessions.length, 0))

function focusSearch(): void {
  searchOpen.value = true
  void Promise.resolve().then(() => {
    const el = document.getElementById('cell-session-search') as HTMLInputElement | null
    el?.focus()
  })
}

onMounted(() => {
  window.addEventListener('cell:focus-search', focusSearch)
})
onUnmounted(() => {
  window.removeEventListener('cell:focus-search', focusSearch)
  window.clearTimeout(debounce)
})
</script>

<template>
  <aside class="side" :class="{ rail: store.sidebarCollapsed }">
    <div class="brand-row">
      <button class="icon" title="收起/展开侧栏 (Ctrl+B)" @click="toggleSidebar()">☰</button>
      <span v-if="!store.sidebarCollapsed" class="brand">cell</span>
      <span class="spacer" />
      <button
        v-if="!store.sidebarCollapsed"
        class="icon"
        :title="store.theme === 'dark' ? '切换到浅色' : '切换到深色'"
        @click="toggleTheme()"
      >
        {{ store.theme === 'dark' ? '☾' : '☀' }}
      </button>
      <button class="icon" title="设置" @click="openSettings(true)">⚙</button>
    </div>

    <div v-if="!store.sidebarCollapsed" class="list-mode">
      <button class="seg" :class="{ on: !store.showArchived }" type="button" @click="store.showArchived && toggleArchived()">
        活跃
      </button>
      <button class="seg" :class="{ on: store.showArchived }" type="button" @click="!store.showArchived && toggleArchived()">
        归档
      </button>
    </div>

    <div v-if="!store.sidebarCollapsed" class="new-session">
      <button class="primary" @click="newSession()">
        <span class="plus">＋</span> 新会话
      </button>
    </div>
    <button v-else class="rail-btn" title="新会话" @click="newSession()">＋</button>

    <button
      v-if="!store.sidebarCollapsed"
      class="entry"
      title="工具、技能与协作任务"
      @click="openSettings(true)"
    >
      <span class="glyph">⚡</span> 插件
    </button>

    <div v-if="!store.sidebarCollapsed" class="ws">
      <div class="ws-head">
        <span class="ws-title">工作区</span>
        <span class="spacer" />
        <button class="icon sm" title="搜索会话" @click="searchOpen = !searchOpen">⌕</button>
      </div>
      <input
        v-if="searchOpen || store.sessionQuery"
        id="cell-session-search"
        v-model="rawQuery"
        class="search"
        type="search"
        placeholder="搜索会话…"
        @input="onQueryInput"
      />

      <div class="list">
        <template v-for="g in groups" :key="g.key">
          <button class="group" @click="toggleGroup(g.key)">
            <span class="caret">{{ expanded[g.key] ? '▾' : '▸' }}</span>
            <span class="group-name">{{ g.label }}</span>
            <span class="count">{{ g.sessions.length }}</span>
          </button>
          <div
            v-for="s in rowsOf(g.key, g.sessions)"
            :key="s.id"
            class="row"
            :class="{ active: s.id === store.currentSession }"
            :title="s.cwd ? `${s.title || s.id}\n${s.cwd}` : s.title || s.id"
          >
            <button class="row-main" @click="selectSession(s.id)">
              <span class="dot" :class="{ live: s.id === store.currentSession && store.streaming }" />
              <span class="row-title">{{ sessionLabel(s) }}</span>
              <span class="age">{{ relativeTime(s.updated_at) }}</span>
            </button>
            <button
              class="row-act"
              :title="store.showArchived ? '恢复到活跃列表' : '归档（记录保留，可恢复）'"
              @click.stop="setArchived(s.id, !store.showArchived)"
            >
              {{ store.showArchived ? '恢复' : '归档' }}
            </button>
          </div>
          <button
            v-if="hiddenCount(g.key, g.sessions.length)"
            class="more"
            @click="toggleGroup(g.key)"
          >
            显示全部 {{ g.sessions.length }} 个
          </button>
        </template>
        <p v-if="!groups.length" class="empty">
          {{ store.sessionQuery ? '没有匹配的会话' : '还没有会话' }}
        </p>
      </div>

      <p v-if="store.sessionQuery" class="summary">{{ shown }} / {{ total }} 个会话</p>
    </div>

    <div v-if="!store.sidebarCollapsed" class="foot">
      <span class="ver">v{{ store.bootstrap?.version ?? '—' }}</span>
      <span class="spacer" />
      <button class="icon sm" title="导出会话" @click="$emit('export')">⤓</button>
    </div>
  </aside>
</template>

<style scoped>
.side {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--cell-alias-bg-raised);
  border-right: 1px solid var(--cell-alias-line-soft);
}

.side.rail {
  align-items: center;
  gap: 6px;
  padding-top: 8px;
}

.brand-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 10px 6px;
}

.rail .brand-row {
  flex-direction: column;
  padding: 0;
}

.brand {
  font-family: var(--cell-mono);
  font-weight: 700;
  letter-spacing: 0.06em;
  font-size: var(--cell-font-size-body);
}

.spacer {
  flex: 1;
}

.icon {
  border: 0;
  background: none;
  color: var(--cell-alias-ink-dim);
  border-radius: var(--cell-radius-xs);
  padding: 3px 6px;
  line-height: 1.2;
}

.icon:hover {
  background: var(--cell-alias-bg-hover);
  color: var(--cell-alias-ink);
}

.icon.sm {
  font-size: var(--cell-font-size-sm);
}

.new-session {
  padding: 4px 10px 8px;
}

.primary,
.rail-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  border: 1px solid var(--cell-alias-accent-line);
  border-radius: var(--cell-radius-sm);
  background: var(--cell-alias-accent-soft);
  color: var(--cell-alias-accent);
  font-size: var(--cell-font-size-sm);
  font-weight: 600;
  padding: 7px 10px;
}

.rail-btn {
  width: 34px;
  height: 34px;
  padding: 0;
  font-size: var(--cell-font-size-lg);
}

.primary:hover,
.rail-btn:hover {
  background: var(--cell-alias-accent);
  color: var(--cell-alias-ink-invert);
}

.plus {
  font-size: var(--cell-font-size-body);
}

.entry {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 10px 6px;
  border: 0;
  border-radius: var(--cell-radius-sm);
  background: none;
  color: var(--cell-alias-ink-dim);
  font-size: var(--cell-font-size-sm);
  padding: 6px 8px;
  text-align: left;
}

.entry:hover {
  background: var(--cell-alias-bg-hover);
  color: var(--cell-alias-ink);
}

.glyph {
  width: 16px;
  text-align: center;
}

.ws {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 4px 6px 0;
  border-top: 1px solid var(--cell-alias-line-soft);
  margin-top: 4px;
}

.ws-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 4px 4px;
}

.ws-title {
  font-size: var(--cell-font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--cell-alias-ink-faint);
}

.search {
  margin: 2px 4px 6px;
  border: 1px solid var(--cell-alias-line);
  border-radius: var(--cell-radius-sm);
  background: var(--cell-alias-bg-base);
  padding: 5px 8px;
  font-size: var(--cell-font-size-sm);
}

.list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-bottom: 6px;
}

.group {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: 0;
  background: none;
  color: var(--cell-alias-ink-faint);
  font-size: var(--cell-font-size-xs);
  padding: 7px 6px 3px;
  text-align: left;
}

.group-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.count {
  font-family: var(--cell-mono);
}

.caret {
  width: 10px;
}

.row {
  display: flex;
  align-items: center;
  width: 100%;
  border: 1px solid transparent;
  border-radius: var(--cell-radius-sm);
}

.row-main {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 1;
  min-width: 0;
  border: 0;
  background: none;
  color: var(--cell-alias-ink);
  font-size: var(--cell-font-size-sm);
  padding: 6px 8px;
  text-align: left;
}

/* only on hover: the list is for opening sessions, archiving is the exception */
.row-act {
  flex: 0 0 auto;
  border: 0;
  background: none;
  color: var(--cell-alias-ink-faint);
  font-size: var(--cell-font-size-xs);
  padding: 0 8px;
  opacity: 0;
}

.row:hover .row-act,
.row-act:focus {
  opacity: 1;
}

.row-act:hover {
  color: var(--cell-alias-accent);
}

.list-mode {
  display: flex;
  gap: 4px;
  padding: 2px 10px 8px;
}

.seg {
  flex: 1;
  border: 1px solid var(--cell-alias-line-soft);
  border-radius: var(--cell-radius-pill);
  background: none;
  color: var(--cell-alias-ink-dim);
  font-size: var(--cell-font-size-xs);
  padding: 2px 0;
}

.seg.on {
  background: var(--cell-alias-accent-soft);
  border-color: var(--cell-alias-accent-line);
  color: var(--cell-alias-accent);
  font-weight: 600;
}

.row:hover {
  background: var(--cell-alias-bg-hover);
}

.row.active {
  background: var(--cell-alias-bg-selected);
  border-color: var(--cell-alias-accent-line);
}

.dot {
  flex: 0 0 auto;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--cell-alias-ink-faint);
}

.row.active .dot {
  background: var(--cell-alias-accent);
}

.dot.live {
  animation: cell-pulse 1.2s ease-in-out infinite;
}

.row-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.age {
  flex: 0 0 auto;
  color: var(--cell-alias-ink-faint);
  font-size: var(--cell-font-size-xs);
}

.more {
  border: 0;
  background: none;
  color: var(--cell-alias-ink-faint);
  font-size: var(--cell-font-size-xs);
  padding: 4px 8px 8px;
  text-align: left;
}

.more:hover {
  color: var(--cell-alias-accent);
}

.empty {
  color: var(--cell-alias-ink-faint);
  font-size: var(--cell-font-size-sm);
  text-align: center;
  margin-top: 20px;
}

.summary {
  margin: 4px 6px 0;
  color: var(--cell-alias-ink-faint);
  font-size: var(--cell-font-size-xs);
}

.foot {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px 8px;
  border-top: 1px solid var(--cell-alias-line-soft);
}

.ver {
  color: var(--cell-alias-ink-faint);
  font-family: var(--cell-mono);
  font-size: var(--cell-font-size-xs);
}
</style>
