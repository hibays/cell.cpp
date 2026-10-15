<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { interrupt, newSession, resume, selectSession, send, store, toggleSidebar } from '../store'
import MessageItem from '../components/MessageItem.vue'
import Composer from '../components/Composer.vue'
import ApprovalCard from '../components/ApprovalCard.vue'
import CommandPalette from '../components/CommandPalette.vue'
import ExportPanel from '../components/ExportPanel.vue'
import StatusBar from '../components/StatusBar.vue'
import SettingsView from './SettingsView.vue'
import { sessionTitle } from '../lib/format'
import { createScrollAnchor } from '../lib/scrollAnchor'
import { computeWindow } from '../lib/window'

const scroller = ref<HTMLDivElement | null>(null)
const exportOpen = ref(false)
const settingsOpen = ref(false)

// --- scroll ownership ---------------------------------------------------------
// The view follows new output only while the reader is at the tail. Our own
// pinning fires the same scroll event a gesture does, so ownership is explicit
// rather than inferred from the event.
const anchor = createScrollAnchor()
// only the affordance needs to be reactive; `stick` is consulted imperatively
const showJump = ref(anchor.showJump)

function syncAnchor(): void {
  showJump.value = anchor.showJump
}

// --- windowing ----------------------------------------------------------------
// A long session used to mount every message. Only the rows near the viewport
// are mounted now; spacers stand in for the rest so the scrollbar stays honest.
const scrollTop = ref(0)
const viewport = ref(0)
const heights = ref<number[]>([])

const win = computed(() =>
  computeWindow({
    count: store.messages.length,
    heights: heights.value,
    scrollTop: scrollTop.value,
    viewport: viewport.value,
    overscan: 3,
  }),
)

const visibleMessages = computed(() => store.messages.slice(win.value.start, win.value.end))

let observer: ResizeObserver | null = null

/** Record the heights of what is currently mounted; unmounted rows keep their estimate. */
function measure(): void {
  const root = scroller.value
  if (!root || !observer) return
  observer.disconnect()
  const next = [...heights.value]
  for (const el of root.querySelectorAll<HTMLElement>('[data-mk]')) {
    observer.observe(el)
    const idx = Number(el.dataset.mk)
    const h = el.getBoundingClientRect().height
    if (Number.isInteger(idx) && idx >= 0 && h > 0) next[idx] = h
  }
  heights.value = next
}

const currentTitle = computed(() =>
  sessionTitle(
    store.sessions.find((s) => s.id === store.currentSession)?.snippet,
    store.currentSession ?? '新会话',
  ),
)

const chips = ['介绍一下这个仓库', '解释 cell.cpp 的架构', '帮我写一个 CMake 选项']

function readScroller(): void {
  const el = scroller.value
  if (!el) return
  scrollTop.value = el.scrollTop
  viewport.value = el.clientHeight
}

function onScroll(): void {
  const el = scroller.value
  if (!el) return
  readScroller()
  anchor.onScroll(
    { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight },
    'user',
  )
  syncAnchor()
}

async function scrollToBottom(): Promise<void> {
  await nextTick()
  const el = scroller.value
  if (!el) return
  el.scrollTop = el.scrollHeight
  // declare it: our pin must not read as the reader leaving the tail
  anchor.onScroll(
    { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight },
    'programmatic',
  )
  readScroller()
  syncAnchor()
}

function jumpToLatest(): void {
  anchor.reset()
  syncAnchor()
  void scrollToBottom()
}

watch(
  () => [store.streamText.length, store.messages.length] as const,
  async () => {
    if (anchor.stick) await scrollToBottom()
    else {
      anchor.onContentGrown({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 })
      syncAnchor()
    }
    await nextTick()
    measure()
  },
)

// a new session means a new list: forget both the window and the ownership
watch(
  () => store.currentSession,
  () => {
    heights.value = []
    anchor.reset()
    syncAnchor()
    void scrollToBottom()
  },
)

onMounted(async () => {
  observer = new ResizeObserver((entries) => {
    const next = [...heights.value]
    let changed = false
    for (const entry of entries) {
      const el = entry.target as HTMLElement
      const idx = Number(el.dataset.mk)
      const h = el.getBoundingClientRect().height
      if (Number.isInteger(idx) && idx >= 0 && h > 0 && next[idx] !== h) {
        next[idx] = h
        changed = true
      }
    }
    if (changed) heights.value = next
  })

  readScroller()
  if (store.currentSession) await selectSession(store.currentSession)
  else {
    const id = await newSession()
    if (id) await selectSession(id)
  }
  await scrollToBottom()
  measure()
})

onUnmounted(() => observer?.disconnect())
</script>

<template>
  <div class="shell">
    <aside class="sidebar" :class="{ closed: !store.sidebarOpen }">
      <div class="side-top">
        <button class="ghost" @click="toggleSidebar()">☰</button>
        <span class="brand">cell</span>
        <button class="primary" @click="newSession()">+ 新会话</button>
      </div>
      <div class="sessions">
        <button
          v-for="s in store.sessions"
          :key="s.id"
          class="srow"
          :class="{ active: s.id === store.currentSession }"
          @click="selectSession(s.id)"
        >
          <span class="title">{{ sessionTitle(s.snippet, s.id.slice(-8)) }}</span>
          <span class="meta">{{ s.messages }} 条</span>
        </button>
        <p v-if="!store.sessions.length" class="empty">还没有会话</p>
      </div>
      <div class="side-bottom">
        <span class="ver">v{{ store.bootstrap?.version }}</span>
      </div>
    </aside>

    <main class="main">
      <header class="topbar">
        <span v-if="!store.sidebarOpen" class="open" @click="toggleSidebar()">☰</span>
        <span class="title">{{ currentTitle }}</span>
        <span class="spacer" />
        <button class="tool" @click="exportOpen = true">导出</button>
        <button class="tool" @click="settingsOpen = true">设置</button>
        <span v-if="store.config" class="chip">{{ store.config.sandbox_mode }}</span>
        <span v-if="store.config" class="chip"
          >think {{ store.config.think_levels[store.config.think_level] }}</span
        >
      </header>

      <div ref="scroller" class="scroll" @scroll="onScroll">
        <div class="column">
          <!-- spacers keep the scrollbar honest for the rows that are not mounted -->
          <div :style="{ height: `${win.padTop}px` }" />
          <MessageItem
            v-for="(m, i) in visibleMessages"
            :key="m.key"
            :message="m"
            :data-mk="win.start + i"
          />
          <div :style="{ height: `${win.padBottom}px` }" />
          <div v-if="store.streaming" class="streaming">
            <pre class="stream-text">{{ store.streamText }}</pre>
            <span class="cursor" />
          </div>
          <ApprovalCard v-for="a in store.approvals" :key="a.request_id" :approval="a" />
          <div v-if="!store.messages.length && !store.streaming" class="welcome">
            <h2>开始吧</h2>
            <p>选择一个起点，或直接输入：</p>
            <div class="chips">
              <button v-for="c in chips" :key="c" @click="send(c)">{{ c }}</button>
            </div>
          </div>
        </div>
      </div>

      <!-- ownership is the reader's: offer a way back instead of yanking the view -->
      <button v-if="showJump" class="jump" type="button" @click="jumpToLatest()">
        ↓ 回到最新
      </button>

      <div class="composer-wrap">
        <Composer />
        <div class="quick">
          <button v-if="store.lastInterrupted && !store.streaming" class="q" @click="resume()">
            ↻ 继续上次中断
          </button>
          <span class="spacer" />
          <button v-if="store.streaming" class="q danger" @click="interrupt()">中断 (Esc)</button>
        </div>
      </div>

      <!-- kernel state, active fence and the last classified failure -->
      <StatusBar />
    </main>

    <div v-if="exportOpen" class="modal" @click.self="exportOpen = false">
      <div class="modal-card">
        <ExportPanel />
      </div>
    </div>
    <SettingsView v-if="settingsOpen" @close="settingsOpen = false" />
    <CommandPalette @open-export="exportOpen = true" @open-settings="settingsOpen = true" />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100%;
}

.sidebar {
  width: 264px;
  flex: 0 0 264px;
  border-right: 1px solid var(--line);
  background: var(--bg-elev);
  display: flex;
  flex-direction: column;
  transition: margin-left 0.2s ease;
}

.sidebar.closed {
  margin-left: -264px;
}

.side-top {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line-soft);
}

.brand {
  font-family: var(--mono);
  font-weight: 700;
  letter-spacing: 0.06em;
}

.ghost {
  border: 0;
  background: none;
  color: var(--ink-dim);
  padding: 4px 6px;
}

.primary {
  margin-left: auto;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
  padding: 5px 12px;
  font-size: 12.5px;
  font-weight: 600;
}

.sessions {
  flex: 1;
  overflow: auto;
  padding: 8px;
}

.srow {
  display: block;
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: none;
  padding: 8px 10px;
  margin-bottom: 2px;
}

.srow:hover {
  background: var(--bg-elev-2);
}

.srow.active {
  background: var(--accent-soft);
  border-color: rgba(59, 130, 246, 0.3);
}

.title {
  display: block;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta {
  color: var(--ink-faint);
  font-size: 11px;
}

.empty {
  color: var(--ink-faint);
  font-size: 12.5px;
  text-align: center;
  margin-top: 24px;
}

.side-bottom {
  padding: 8px 12px;
  border-top: 1px solid var(--line-soft);
}

.ver {
  color: var(--ink-faint);
  font-family: var(--mono);
  font-size: 11px;
}

.jump {
  position: absolute;
  right: 28px;
  bottom: 108px;
  z-index: 5;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--bg-elev);
  color: var(--ink-dim);
  font: inherit;
  font-size: 12px;
  padding: 5px 14px;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
}

.jump:hover {
  color: var(--ink);
  border-color: var(--ink-faint);
}

.main {
  position: relative; /* anchors the jump-to-latest button */
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--bg-elev);
}

.topbar .title {
  font-weight: 600;
  font-size: 14px;
}

.open {
  cursor: pointer;
  color: var(--ink-dim);
}

.spacer {
  flex: 1;
}

.chip {
  font-size: 11px;
  font-family: var(--mono);
  color: var(--ink-dim);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 1px 9px;
}

.tool {
  border: 1px solid var(--line);
  background: var(--bg-elev-2);
  border-radius: var(--radius-sm);
  padding: 3px 12px;
  font-size: 12.5px;
  color: var(--ink-dim);
}

.tool:hover {
  border-color: var(--accent);
  color: var(--ink);
}

.modal {
  position: fixed;
  inset: 0;
  background: rgba(3, 7, 18, 0.6);
  backdrop-filter: blur(3px);
  display: grid;
  place-items: center;
  z-index: 70;
  animation: cell-fade-in 0.12s ease both;
}

.modal-card {
  width: min(520px, 92vw);
  max-height: 84vh;
  overflow: auto;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 18px 20px 22px;
}

.scroll {
  flex: 1;
  overflow: auto;
}

.column {
  max-width: 860px;
  margin: 0 auto;
  padding: 18px 22px 26px;
}

.streaming {
  padding: 10px 0;
}

.stream-text {
  display: inline;
  margin: 0;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--ink);
}

.streaming .cursor {
  display: inline-block;
  width: 8px;
  height: 15px;
  background: var(--accent);
  border-radius: 2px;
  animation: cell-blink 1s steps(2) infinite;
  vertical-align: text-bottom;
}

.welcome {
  text-align: center;
  padding: 8vh 0;
  color: var(--ink-dim);
  animation: cell-fade-in 0.4s ease both;
}

.welcome h2 {
  color: var(--ink);
  margin: 0 0 6px;
}

.chips {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
  margin-top: 14px;
}

.chips button {
  border: 1px solid var(--line);
  background: var(--bg-elev);
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 12.5px;
  color: var(--ink-dim);
}

.chips button:hover {
  border-color: var(--accent);
  color: var(--ink);
}

.composer-wrap {
  border-top: 1px solid var(--line);
  padding: 12px 22px 14px;
  background: var(--bg);
}

.quick {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 816px;
  margin: 8px auto 0;
}

.q {
  border: 1px solid var(--line);
  background: var(--bg-elev);
  border-radius: 999px;
  padding: 3px 12px;
  font-size: 12px;
  color: var(--ink-dim);
}

.q.danger {
  color: #fca5a5;
  border-color: rgba(239, 68, 68, 0.35);
}

/* ---- responsive -------------------------------------------------------
   The sidebar becomes an overlay drawer below 900px so the conversation
   keeps the full width; typography and paddings tighten below 640px. */
@media (max-width: 900px) {
  .sidebar {
    position: fixed;
    z-index: 60;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(78vw, 300px);
    flex: 0 0 auto;
    box-shadow: var(--shadow);
  }
  .sidebar.closed {
    margin-left: 0;
    transform: translateX(-104%);
  }
  .topbar {
    padding: 10px 12px;
  }
  .topbar .chip {
    display: none;
  }
  .column {
    padding: 14px 12px 10px;
  }
}

@media (max-width: 640px) {
  .topbar .title {
    font-size: 13px;
  }
  .tool {
    padding: 3px 9px;
  }
  .chips {
    flex-wrap: wrap;
  }
  .welcome h2 {
    font-size: 1.05rem;
  }
  .modal-card {
    width: 96vw;
    max-height: 90vh;
    padding: 14px 14px 18px;
  }
  .composer-wrap {
    padding: 0 8px 10px;
  }
}

</style>
