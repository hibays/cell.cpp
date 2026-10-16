<script setup lang="ts">
// One file, read-only, highlighted.
//
// The viewer is deliberately the only place that shows file *content*: the file
// listing says what exists, the viewer says what is in it, and both are the same
// sandboxed, capped, read-only pair the kernel serves. Anything larger than the
// render cap is announced as truncated rather than silently half-shown.
import { computed, ref } from 'vue'
import type { FileContent } from '../lib/api'
import { grammarOf, highlightToHtml } from '../lib/highlight'
import { attach, store, toast } from '../store'
import { fileChangeTotals, fileChanges } from '../lib/diffs'
import { diffSummary } from '../lib/diffView'
import { formatCompact, formatDateTime } from '../lib/format'

const props = defineProps<{ file: FileContent }>()
const emit = defineEmits<{ close: [] }>()

const RENDER_MAX = 64 * 1024

// What this session did to *this* file, taken from the transcript: the kernel
// made the edits and reported them, and the viewer shows what it reported.
const changes = computed(() => (props.file ? fileChanges(store.messages, props.file.path) : []))
const totals = computed(() => fileChangeTotals(changes.value))
const showChanges = ref(false)

const shown = computed(() => props.file.content.slice(0, RENDER_MAX))
const lang = computed(() => {
  const ext = props.file.name.split('.').pop() ?? ''
  return grammarOf(ext) ? ext : ''
})
const html = computed(() => highlightToHtml(shown.value, lang.value))
const cut = computed(() => props.file.truncated || props.file.content.length > RENDER_MAX)

async function copyPath(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.file.path)
    toast('ok', '路径已复制')
  } catch {
    toast('warn', '剪贴板不可用')
  }
}

function onAttach(): void {
  attach(props.file.path)
  toast('ok', `已附加 ${props.file.path}`)
}
</script>

<template>
  <div class="viewer">
    <div class="head">
      <button class="icon" type="button" title="返回文件列表" @click="emit('close')">←</button>
      <span class="name" :title="file.path">{{ file.name }}</span>
      <span class="meta">
        {{ formatCompact(file.size) }} 字节
        <template v-if="file.mtime"> · {{ formatDateTime(file.mtime) }}</template>
      </span>
      <span class="spacer" />
      <button class="act" type="button" title="复制路径" @click="copyPath()">⧉</button>
      <button class="act" type="button" title="作为参考文件附加到输入框" @click="onAttach()">附加</button>
    </div>
    <!-- what this session changed here, before the current contents -->
    <div v-if="changes.length" class="changes">
      <button class="cbar" type="button" @click="showChanges = !showChanges">
        <span class="caret">{{ showChanges ? '▾' : '▸' }}</span>
        本次会话的改动
        <span class="dim">{{ changes.length }} 次 · +{{ totals.added }} −{{ totals.removed }}</span>
      </button>
      <div v-for="c in changes" v-show="showChanges" :key="c.callId" class="change">
        <p class="chead">
          <span class="tool">{{ c.tool }}</span>
          <span v-if="c.diff" class="dim">{{ diffSummary(c.diff) }}</span>
          <span v-if="c.seconds !== undefined" class="dim">{{ c.seconds.toFixed(2) }}s</span>
        </p>
        <table v-if="c.diff" class="diff">
          <tr v-for="(row, i) in c.diff.rows" :key="i" :class="row.kind">
            <td class="ln">{{ row.oldNo ?? '' }}</td>
            <td class="ln">{{ row.newNo ?? '' }}</td>
            <td class="tx">{{ row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' ' }}{{ row.text }}</td>
          </tr>
        </table>
        <pre v-else class="plain">{{ c.raw }}</pre>
      </div>
    </div>
    <p v-if="file.binary" class="empty">二进制文件，不在此预览。</p>
    <template v-else>
      <pre class="code" v-html="html" />
      <p v-if="cut" class="cut">已显示前 {{ formatCompact(shown.length) }} 字符（内核的读取上限与渲染上限都在这）</p>
    </template>
  </div>
</template>

<style scoped>
.viewer {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}

.head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--cell-alias-line-soft);
  font-size: var(--cell-font-size-sm);
}

.icon,
.act {
  border: 1px solid transparent;
  background: none;
  color: var(--cell-alias-ink-dim);
  border-radius: var(--cell-radius-xs);
  padding: 1px 6px;
  font-size: var(--cell-font-size-xs);
}

.icon:hover,
.act:hover {
  border-color: var(--cell-alias-line);
  color: var(--cell-alias-ink);
}

.name {
  font-family: var(--cell-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  color: var(--cell-alias-ink-faint);
  font-size: var(--cell-font-size-xs);
  white-space: nowrap;
}

.spacer {
  flex: 1;
}

.code {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 10px 12px;
  overflow: auto;
  font-family: var(--cell-mono);
  font-size: var(--cell-mono-size);
  line-height: 1.55;
  background: var(--cell-alias-code-bg);
  white-space: pre;
}

.changes {
  border-bottom: 1px solid var(--cell-alias-line-soft);
}

.cbar {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 0;
  background: none;
  color: var(--cell-alias-ink);
  font-size: var(--cell-font-size-xs);
  padding: 6px 10px;
  text-align: left;
}

.cbar:hover {
  background: var(--cell-alias-bg-hover);
}

.caret {
  color: var(--cell-alias-ink-faint);
}

.change {
  padding: 4px 10px 10px;
}

.chead {
  display: flex;
  gap: 8px;
  margin: 4px 0;
  font-size: var(--cell-font-size-xs);
}

.chead .tool {
  font-family: var(--cell-mono);
  color: var(--cell-alias-ink-dim);
}

.diff {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--cell-mono);
  font-size: var(--cell-mono-size);
  line-height: 1.5;
}

.diff td {
  padding: 0 4px;
  vertical-align: top;
  white-space: pre-wrap;
  word-break: break-word;
}

.diff .ln {
  width: 1%;
  text-align: right;
  color: var(--cell-alias-ink-faint);
  user-select: none;
}

.diff .tx {
  width: 100%;
}

.diff tr.add {
  background: rgba(34, 197, 94, 0.12);
}

.diff tr.add .tx {
  color: var(--cell-alias-good);
}

.diff tr.del {
  background: rgba(239, 68, 68, 0.12);
}

.diff tr.del .tx {
  color: var(--cell-alias-bad);
}

.diff tr.meta .tx {
  color: var(--cell-alias-ink-faint);
}

.plain {
  margin: 4px 0 0;
  padding: 6px 8px;
  background: var(--cell-alias-code-bg);
  border-radius: var(--cell-radius-sm);
  font-family: var(--cell-mono);
  font-size: var(--cell-font-size-xs);
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--cell-alias-ink-dim);
}

.empty,
.cut {
  margin: 10px 12px;
  color: var(--cell-alias-ink-faint);
  font-size: var(--cell-font-size-xs);
}
</style>
