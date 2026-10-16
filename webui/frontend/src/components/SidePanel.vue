<script setup lang="ts">
// The right-hand panel: 文件 / 改动 / 日志.
//
// Three views of the same session, each backed by something real:
//   * 文件  — the kernel's read-only listing and content endpoints, so browsing
//     the workspace and reading a file never leaves the sandbox the agent works
//     in;
//   * 改动  — derived from the transcript's mutating tool calls (lib/changes.ts),
//     which needs no endpoint because the shell already has the data;
//   * 日志  — the runtime log's tail, polled only while the tab is on screen.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import FileViewer from './FileViewer.vue'
import {
  attach,
  closeFile,
  openFileAt,
  refreshFiles,
  refreshLogs,
  setSideTab,
  store,
  toggleRightbar,
  toast,
} from '../store'
import { changedFiles } from '../lib/changes'
import { formatCompact } from '../lib/format'

const PANEL_REFRESH_MS = 3000

const crumbs = computed(() => (store.filePath ? store.filePath.split('/').filter(Boolean) : []))
const changed = computed(() => changedFiles(store.messages))

function go(path: string): void {
  closeFile()
  void refreshFiles(path)
}

function up(): void {
  go(crumbs.value.slice(0, -1).join('/'))
}

async function copyPath(path: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(path)
    toast('ok', '路径已复制')
  } catch {
    toast('warn', '剪贴板不可用')
  }
}

function onAttach(path: string): void {
  attach(path)
  toast('ok', `已附加 ${path}`)
}

// The log tail is the only polling surface in the shell, and it polls only while
// it is the visible tab: a diagnostics pane nobody is looking at should not be
// a stream of requests.
let timer = 0
const logsFocused = ref(true)

function syncPolling(): void {
  const active = store.rightbarOpen && store.sideTab === 'logs' && !store.openFile
  if (active && !timer) {
    void refreshLogs()
    timer = window.setInterval(() => {
      if (logsFocused.value) void refreshLogs()
    }, PANEL_REFRESH_MS)
  } else if (!active && timer) {
    window.clearInterval(timer)
    timer = 0
  }
}

watch(() => [store.rightbarOpen, store.sideTab, store.openFile], syncPolling)
onMounted(() => {
  if (!store.files.length) void refreshFiles()
  syncPolling()
})
onUnmounted(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<template>
  <aside class="panel">
    <div class="tabs">
      <button class="tab" :class="{ on: store.sideTab === 'files' }" type="button" @click="setSideTab('files')">
        文件
      </button>
      <button class="tab" :class="{ on: store.sideTab === 'changes' }" type="button" @click="setSideTab('changes')">
        改动<span v-if="changed.length" class="badge">{{ changed.length }}</span>
      </button>
      <button class="tab" :class="{ on: store.sideTab === 'logs' }" type="button" @click="setSideTab('logs')">
        日志
      </button>
      <span class="spacer" />
      <button class="act" type="button" title="关闭面板" @click="toggleRightbar(false)">×</button>
    </div>

    <FileViewer v-if="store.openFile" :file="store.openFile" @close="closeFile()" />

    <template v-else>
      <div v-if="store.sideTab === 'files'" class="browser">
        <div class="crumbs">
          <button class="crumb" type="button" @click="go('')">工作区</button>
          <template v-for="(c, i) in crumbs" :key="c + i">
            <span class="sep">/</span>
            <button class="crumb" type="button" @click="go(crumbs.slice(0, i + 1).join('/'))">{{ c }}</button>
          </template>
        </div>
        <div class="rows">
          <button v-if="store.filePath" class="row" type="button" @click="up()">
            <span class="ico">↰</span><span class="name">..</span>
          </button>
          <button
            v-for="e in store.files"
            :key="e.path"
            class="row"
            type="button"
            @click="e.dir ? go(e.path) : openFileAt(e.path)"
          >
            <span class="ico">{{ e.dir ? '▸' : '·' }}</span>
            <span class="name" :title="e.path">{{ e.name }}{{ e.dir ? '/' : '' }}</span>
            <span class="meta">{{ e.dir ? '' : e.size >= 0 ? formatCompact(e.size) : '' }}</span>
          </button>
          <p v-if="!store.files.length" class="empty">这个目录是空的</p>
        </div>
      </div>

      <div v-else-if="store.sideTab === 'changes'" class="rows">
        <p v-if="!changed.length" class="empty">这一会话还没有写类工具调用（write / edit / create …）</p>
        <div v-for="c in changed" :key="c.path" class="row static">
          <span class="name" :title="c.path">{{ c.path }}</span>
          <span class="meta">{{ c.tools.join(' · ') }} ×{{ c.edits }}</span>
          <button class="mini" type="button" title="复制路径" @click="copyPath(c.path)">⧉</button>
          <button class="mini" type="button" title="打开" @click="openFileAt(c.path)">查看</button>
          <button class="mini" type="button" title="作为参考文件附加" @click="onAttach(c.path)">附加</button>
        </div>
      </div>

      <div v-else class="logs">
        <div class="log-head">
          <span class="meta">
            {{ store.logLines.length }} 行<template v-if="store.logsTruncated"> · 仅尾部</template>
          </span>
          <span class="spacer" />
          <button class="mini" type="button" @click="refreshLogs()">刷新</button>
        </div>
        <pre class="log-body">{{ store.logLines.join('\n') }}</pre>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--cell-alias-line-soft);
}

.tab {
  border: 1px solid transparent;
  background: none;
  color: var(--cell-alias-ink-dim);
  border-radius: var(--cell-radius-pill);
  padding: 2px 10px;
  font-size: var(--cell-font-size-xs);
}

.tab.on {
  background: var(--cell-alias-accent-soft);
  color: var(--cell-alias-accent);
  font-weight: 600;
}

.badge {
  margin-left: 4px;
  font-family: var(--cell-mono);
  color: var(--cell-alias-ink-faint);
}

.act,
.mini {
  border: 1px solid transparent;
  background: none;
  color: var(--cell-alias-ink-dim);
  border-radius: var(--cell-radius-xs);
  padding: 1px 6px;
  font-size: var(--cell-font-size-xs);
}

.act:hover,
.mini:hover {
  border-color: var(--cell-alias-line);
  color: var(--cell-alias-ink);
}

.spacer {
  flex: 1;
}

.browser,
.rows,
.logs {
  min-height: 0;
  overflow: auto;
  flex: 1;
  padding: 6px;
}

.crumbs {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: wrap;
  padding: 2px 4px 6px;
  font-size: var(--cell-font-size-xs);
}

.crumb {
  border: 0;
  background: none;
  color: var(--cell-alias-ink-dim);
  font-size: inherit;
  padding: 0 2px;
}

.crumb:hover {
  color: var(--cell-alias-accent);
}

.sep {
  color: var(--cell-alias-ink-faint);
}

.row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: 0;
  border-radius: var(--cell-radius-xs);
  background: none;
  color: var(--cell-alias-ink);
  font-size: var(--cell-font-size-xs);
  padding: 4px 6px;
  text-align: left;
}

.row:hover {
  background: var(--cell-alias-bg-hover);
}

.row.static {
  cursor: default;
}

.row .ico {
  width: 10px;
  color: var(--cell-alias-ink-faint);
}

.row .name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--cell-mono);
}

.row .meta {
  color: var(--cell-alias-ink-faint);
  white-space: nowrap;
}

.log-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px 6px;
}

.meta {
  color: var(--cell-alias-ink-faint);
  font-size: var(--cell-font-size-xs);
}

.log-body {
  margin: 0;
  padding: 8px;
  background: var(--cell-alias-code-bg);
  border-radius: var(--cell-radius-sm);
  font-family: var(--cell-mono);
  font-size: var(--cell-font-size-xs);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--cell-alias-ink-dim);
}

.empty {
  margin: 14px 8px;
  color: var(--cell-alias-ink-faint);
  font-size: var(--cell-font-size-sm);
  line-height: 1.7;
}
</style>
