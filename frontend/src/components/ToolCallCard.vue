<script setup lang="ts">
import { computed } from 'vue'
import type { UiToolCall } from '../store'
import { formatDuration } from '../lib/format'

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
</script>

<template>
  <details class="tool" :class="statusClass">
    <summary>
      <span class="name">{{ tool.name }}</span>
      <span class="status">{{ statusLabel }}</span>
      <span v-if="tool.seconds !== undefined" class="secs">{{ formatDuration(tool.seconds) }}</span>
      <code v-if="tool.args" class="args">{{
        tool.args.length > 90 ? tool.args.slice(0, 89) + '…' : tool.args
      }}</code>
    </summary>
    <pre v-if="tool.output" class="out">{{
      tool.output.length > 4000 ? tool.output.slice(-4000) : tool.output
    }}</pre>
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
