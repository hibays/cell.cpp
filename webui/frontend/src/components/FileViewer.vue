<script setup lang="ts">
// One file, read-only, highlighted.
//
// The viewer is deliberately the only place that shows file *content*: the file
// listing says what exists, the viewer says what is in it, and both are the same
// sandboxed, capped, read-only pair the kernel serves. Anything larger than the
// render cap is announced as truncated rather than silently half-shown.
import { computed } from 'vue'
import type { FileContent } from '../lib/api'
import { grammarOf, highlightToHtml } from '../lib/highlight'
import { attach, toast } from '../store'
import { formatCompact, formatDateTime } from '../lib/format'

const props = defineProps<{ file: FileContent }>()
const emit = defineEmits<{ close: [] }>()

const RENDER_MAX = 64 * 1024

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

.empty,
.cut {
  margin: 10px 12px;
  color: var(--cell-alias-ink-faint);
  font-size: var(--cell-font-size-xs);
}
</style>
