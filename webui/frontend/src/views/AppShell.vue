<script setup lang="ts">
// AppShell: the frame around everything — three CSS-grid columns, the header
// with its view switch, and the telemetry strip.
//
// Layout rules come from lib/layout.ts (ported constants and the solver): the
// arithmetic decides discrete widths, CSS Grid does the squeezing. Drag handles
// report one update per animation frame (lib/useDrag.ts) and a ResizeObserver
// watches the frame — never `window` — so the auto-collapse follows the window
// the shell is actually in.
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  newSession,
  openSettings,
  refreshJobs,
  setRightbarWidth,
  setSidebarWidth,
  setView,
  store,
  toggleRightbar,
  toggleSidebar,
} from '../store'
import Sidebar from '../components/Sidebar.vue'
import StatusBar from '../components/StatusBar.vue'
import CommandPalette from '../components/CommandPalette.vue'
import ExportPanel from '../components/ExportPanel.vue'
import ConversationView from './ConversationView.vue'
import TraceView from './TraceView.vue'
import SettingsView from './SettingsView.vue'
import { SIDEBAR_MAX, SIDEBAR_MIN, gridTemplate, solveColumns } from '../lib/layout'
import { useDragHandle } from '../lib/useDrag'
import { sessionTitle } from '../lib/format'

const frame = ref<HTMLElement | null>(null)
const frameWidth = ref(0)
const exportOpen = ref(false)

const cols = computed(() =>
  solveColumns({
    width: frameWidth.value,
    sidebarWidth: store.sidebarWidth,
    collapsed: store.sidebarCollapsed,
    rightbarOpen: store.rightbarOpen,
    rightbarWidth: store.rightbarWidth,
  }),
)

const template = computed(() => gridTemplate(cols.value))

// One rAF update per gesture: the handle reports the total delta since the
// pointer went down, and the solver keeps it inside the allowed range.
const {
  dragging: sidebarDragging,
  onPointerDown: onSidebarDrag,
} = useDragHandle((dx) => {
  const base = store.sidebarCollapsed ? 0 : store.sidebarWidth
  const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, base + dx))
  setSidebarWidth(next)
})

const {
  dragging: rightbarDragging,
  onPointerDown: onRightbarDrag,
} = useDragHandle((dx) => setRightbarWidth(store.rightbarWidth - dx))

const title = computed(
  () => store.sessions.find((s) => s.id === store.currentSession)?.title || '新会话',
)

const subtitle = computed(() => {
  const s = store.sessions.find((x) => x.id === store.currentSession)
  return s ? sessionTitle(s.snippet, s.id.slice(-6)) : ''
})

const cwd = computed(() => store.sessions.find((s) => s.id === store.currentSession)?.cwd ?? '')

let ro: ResizeObserver | null = null
let raf = 0

onMounted(() => {
  ro = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width ?? 0
    // coalesce to a frame: a drag can deliver these faster than we can lay out
    if (raf) cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      raf = 0
      frameWidth.value = w
    })
  })
  if (frame.value) ro.observe(frame.value)
  void refreshJobs()
})

onUnmounted(() => {
  ro?.disconnect()
  if (raf) cancelAnimationFrame(raf)
})
</script>

<template>
  <div class="shell">
    <div ref="frame" class="frame" :style="{ gridTemplateColumns: template }">
      <Sidebar v-if="frameWidth === 0 || cols.sidebar > 0" @export="exportOpen = true" />

      <div
        v-if="!cols.collapsed"
        class="handle"
        :class="{ dragging: sidebarDragging }"
        role="separator"
        aria-orientation="vertical"
        @pointerdown="onSidebarDrag"
      />

      <main class="main">
        <header class="top">
          <button v-if="cols.collapsed" class="icon-open" title="展开侧栏 (Ctrl+B)" @click="toggleSidebar()">
            ☰
          </button>
          <div class="titles">
            <h1 class="name" :title="cwd">{{ title }}</h1>
            <p v-if="subtitle" class="sub">{{ subtitle }}</p>
          </div>

          <span v-if="store.jobs.workers" class="chip" title="协作任务中的子智能体">
            {{ store.jobs.workers }} 个子智能体
          </span>
          <span v-if="store.config" class="chip">{{ store.config.sandbox_mode }}</span>
          <span v-if="store.config" class="chip">
            think {{ store.config.think_levels[store.config.think_level] }}
          </span>

          <span class="spacer" />

          <div class="tabs" role="tablist">
            <button
              class="tab"
              :class="{ on: store.view === 'chat' }"
              role="tab"
              :aria-selected="store.view === 'chat'"
              @click="setView('chat')"
            >
              对话
            </button>
            <button
              class="tab"
              :class="{ on: store.view === 'trace' }"
              role="tab"
              :aria-selected="store.view === 'trace'"
              @click="setView('trace')"
            >
              轨迹
            </button>
          </div>

          <button class="tool" title="新建会话 (Ctrl+N)" @click="newSession()">＋</button>
          <button class="tool" title="导出会话" @click="exportOpen = true">导出</button>
          <button class="tool" title="设置" @click="openSettings(true)">设置</button>
          <button
            class="tool"
            :class="{ on: store.rightbarOpen }"
            title="右侧面板"
            @click="toggleRightbar()"
          >
            ▥
          </button>
        </header>

        <!-- both views stay mounted: the conversation owns scroll position and
             its row-height cache, and remounting it would throw both away -->
        <ConversationView v-show="store.view === 'chat'" />
        <TraceView v-show="store.view === 'trace'" />
      </main>

      <div
        v-if="cols.rightbar > 0"
        class="handle"
        :class="{ dragging: rightbarDragging }"
        role="separator"
        aria-orientation="vertical"
        @pointerdown="onRightbarDrag"
      />

      <aside v-if="cols.rightbar > 0" class="rightbar">
        <div class="rb-head">
          <span>面板</span>
          <span class="spacer" />
          <button class="tool" title="关闭" @click="toggleRightbar(false)">×</button>
        </div>
        <p class="rb-empty">
          文件与变更面板将在下一阶段接入（内核的文件列举与修订审查端点）。
        </p>
      </aside>
    </div>

    <StatusBar />

    <div v-if="exportOpen" class="modal" @click.self="exportOpen = false">
      <div class="modal-card">
        <ExportPanel />
      </div>
    </div>
    <SettingsView v-if="store.settingsOpen" @close="openSettings(false)" />
    <CommandPalette @open-export="exportOpen = true" @open-settings="openSettings(true)" />
  </div>
</template>

<style scoped>
.shell {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.frame {
  flex: 1;
  min-height: 0;
  display: grid;
  background: var(--cell-alias-bg-base);
}

.handle {
  position: relative;
  margin: 0 -3px;
  width: 6px;
  cursor: col-resize;
  z-index: 6;
  background: none;
}

.handle::after {
  content: '';
  position: absolute;
  inset: 0 2px;
  border-radius: var(--cell-radius-pill);
  background: transparent;
}

.handle:hover::after,
.handle.dragging::after {
  background: var(--cell-alias-accent);
}

.main {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.top {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--cell-alias-line-soft);
  background: var(--cell-alias-bg-raised);
}

.icon-open {
  border: 0;
  background: none;
  color: var(--cell-alias-ink-dim);
  border-radius: var(--cell-radius-xs);
  padding: 2px 6px;
}

.icon-open:hover {
  background: var(--cell-alias-bg-hover);
  color: var(--cell-alias-ink);
}

.titles {
  min-width: 0;
}

.name {
  margin: 0;
  font-size: var(--cell-font-size-body);
  font-weight: 600;
  color: var(--cell-alias-ink-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 34ch;
}

.sub {
  margin: 0;
  font-size: var(--cell-font-size-xs);
  color: var(--cell-alias-ink-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 40ch;
}

.spacer {
  flex: 1;
}

.chip {
  font-size: var(--cell-font-size-xs);
  font-family: var(--cell-mono);
  color: var(--cell-alias-ink-dim);
  border: 1px solid var(--cell-alias-line);
  border-radius: var(--cell-radius-pill);
  padding: 1px 9px;
  white-space: nowrap;
}

.tabs {
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--cell-alias-line);
  border-radius: var(--cell-radius-pill);
  background: var(--cell-alias-bg-base);
}

.tab {
  border: 0;
  background: none;
  color: var(--cell-alias-ink-dim);
  font-size: var(--cell-font-size-sm);
  border-radius: var(--cell-radius-pill);
  padding: 2px 12px;
}

.tab.on {
  background: var(--cell-alias-accent-soft);
  color: var(--cell-alias-accent);
  font-weight: 600;
}

.tool {
  border: 1px solid transparent;
  background: none;
  color: var(--cell-alias-ink-dim);
  border-radius: var(--cell-radius-sm);
  padding: 3px 9px;
  font-size: var(--cell-font-size-sm);
}

.tool:hover,
.tool.on {
  border-color: var(--cell-alias-line);
  background: var(--cell-alias-bg-raised-2);
  color: var(--cell-alias-ink);
}

.rightbar {
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--cell-alias-line-soft);
  background: var(--cell-alias-bg-raised);
}

.rb-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--cell-alias-line-soft);
  font-size: var(--cell-font-size-sm);
  color: var(--cell-alias-ink-dim);
}

.rb-empty {
  margin: 14px;
  color: var(--cell-alias-ink-faint);
  font-size: var(--cell-font-size-sm);
  line-height: 1.7;
}

.modal {
  position: fixed;
  inset: 0;
  background: var(--cell-alias-bg-overlay);
  backdrop-filter: blur(3px);
  display: grid;
  place-items: center;
  z-index: 70;
  animation: cell-fade-in var(--cell-motion-fast) both;
}

.modal-card {
  width: min(520px, 92vw);
  max-height: 84vh;
  overflow: auto;
  background: var(--cell-alias-bg-raised);
  border: 1px solid var(--cell-alias-line);
  border-radius: var(--cell-radius-md);
  box-shadow: var(--cell-alias-shadow);
  padding: 18px 20px 22px;
}

@media (max-width: 900px) {
  .titles .sub,
  .top .chip {
    display: none;
  }
}
</style>
