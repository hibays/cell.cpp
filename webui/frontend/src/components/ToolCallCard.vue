<script setup lang="ts">
import { computed, ref } from 'vue'
import type { UiToolCall } from '../store'
import { clipOutput, formatDuration } from '../lib/format'

const props = defineProps<{ tool: UiToolCall }>()

const statusLabel = computed(() => {
  switch (props.tool.status) {
    case 'running':
      return '运行中'
    case 'blocked':
      return '被沙箱阻止'
    case 'denied':
      return '已拒绝'
    default:
      return '完成'
  }
})
const statusClass = computed(() => `s-${props.tool.status}`)

// Tool output is arbitrary: a build log or `cat` of a big file can be megabytes.
// Collapsed we show the tail (that is where a failure is), expanded we still cap
// the DOM — rendering 5 MB of <pre> freezes the renderer, and a frozen UI hides
// the very error the user opened the card to read.
const OUTPUT_TAIL = 4000
const OUTPUT_HARD_CAP = 200_000

const showAll = ref(false)

const view = computed(() =>
  clipOutput(props.tool.output, {
    tail: OUTPUT_TAIL,
    cap: OUTPUT_HARD_CAP,
    expand: showAll.value,
  }),
)

// never put a megabyte string in a title attribute either
const argsTitle = computed(() => (props.tool.args.length > 600 ? props.tool.args.slice(0, 600) + '…' : props.tool.args))
</script>

<template>
  <details class="tool" :class="statusClass">
    <summary class="summary">
      <span class="name">{{ tool.name }}</span>
      <span class="status">{{ statusLabel }}</span>
      <span v-if="tool.seconds !== undefined" class="secs">{{ formatDuration(tool.seconds) }}</span>
      <code v-if="tool.args" class="args" :title="argsTitle">{{
        tool.args.length > 90 ? tool.args.slice(0, 89) + '…' : tool.args
      }}</code>
    </summary>

    <template v-if="tool.output">
      <p v-if="view.cut" class="cut">
        <span v-if="view.fromEnd">输出过长，仅显示末尾 {{ OUTPUT_TAIL.toLocaleString() }} 字符</span>
        <span v-else>输出过长，已截断至前 {{ OUTPUT_HARD_CAP.toLocaleString() }} 字符</span>
        <button type="button" class="more" @click="showAll = !showAll">
          {{ showAll ? '只看末尾' : '展开全部' }}
        </button>
      </p>
      <pre class="out">{{ view.text }}</pre>
    </template>
  </details>
</template>

<style scoped>
.tool {
  margin: 8px 0;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-elev);
  font-size: 12.5px;
  overflow: hidden;
}

.summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  cursor: pointer;
  list-style: none;
}

.summary::-webkit-details-marker {
  display: none;
}

.name {
  font-family: var(--mono);
  color: #93c5fd;
}

.status {
  color: var(--ink-faint);
  font-size: 11px;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 0 8px;
}

.secs {
  color: var(--ink-faint);
  font-family: var(--mono);
}

.args {
  color: var(--ink-dim);
  font-family: var(--mono);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.cut {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 6px 12px;
  border-top: 1px solid var(--line-soft);
  background: rgba(245, 158, 11, 0.08);
  color: var(--warn);
  font-size: 11px;
}

.more {
  border: 1px solid var(--line);
  background: transparent;
  color: inherit;
  border-radius: 6px;
  padding: 1px 8px;
  font: inherit;
  cursor: pointer;
}

.out {
  margin: 0;
  padding: 10px 12px;
  border-top: 1px solid var(--line-soft);
  background: #0d1424;
  color: var(--ink-dim);
  font-family: var(--mono);
  font-size: 11.5px;
  line-height: 1.55;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.s-running .status {
  color: var(--warn);
  border-color: rgba(245, 158, 11, 0.4);
  animation: cell-pulse 1.2s ease-in-out infinite;
}

.s-blocked .status,
.s-denied .status {
  color: var(--bad);
  border-color: rgba(239, 68, 68, 0.4);
}
</style>
