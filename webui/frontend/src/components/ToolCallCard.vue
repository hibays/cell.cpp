<script setup lang="ts">
import { computed, ref } from 'vue'
import type { UiToolCall } from '../store'
import { clipOutput, formatDuration } from '../lib/format'
import { exitCodeOf, parseUnifiedDiff, renderKindOf } from '../lib/blocks'

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

// A diff and a shell transcript get their own rendering: per-line colouring with
// a +N/−M summary, and an exit code surfaced instead of buried on the last line.
const kind = computed(() => renderKindOf(props.tool.output))
const code = computed(() => (kind.value === 'terminal' ? exitCodeOf(props.tool.output) : null))

// same reasoning as the plain cap: a 5000-line diff in one <pre> freezes the view
const DIFF_LINES = 400
const DIFF_LINES_EXPANDED = 2000

const diffView = computed(() => {
  if (kind.value !== 'diff') return null
  const parsed = parseUnifiedDiff(props.tool.output)
  if (!parsed) return null
  const limit = showAll.value ? DIFF_LINES_EXPANDED : DIFF_LINES
  const cut = parsed.lines.length > limit
  return { lines: cut ? parsed.lines.slice(0, limit) : parsed.lines, cut, stats: parsed.stats }
})
</script>

<template>
  <details class="tool" :class="statusClass">
    <summary class="summary">
      <span class="name">{{ tool.name }}</span>
      <template v-if="diffView">
        <span class="badge add">+{{ diffView.stats.added }}</span>
        <span class="badge del">−{{ diffView.stats.removed }}</span>
      </template>
      <span v-else-if="code !== null" class="badge" :class="code === 0 ? 'add' : 'del'">exit {{ code }}</span>
      <span class="status">{{ statusLabel }}</span>
      <span v-if="tool.seconds !== undefined" class="secs">{{ formatDuration(tool.seconds) }}</span>
      <code v-if="tool.args" class="args" :title="argsTitle">{{
        tool.args.length > 90 ? tool.args.slice(0, 89) + '…' : tool.args
      }}</code>
    </summary>

    <template v-if="tool.output">
      <div v-if="diffView">
        <p v-if="diffView.cut" class="cut">
          差异过长，仅显示前 {{ (showAll ? DIFF_LINES_EXPANDED : DIFF_LINES).toLocaleString() }} 行
          <button type="button" class="more" @click="showAll = !showAll">
            {{ showAll ? '收起' : '展开更多' }}
          </button>
        </p>
        <pre class="diff"><span
            v-for="(l, i) in diffView.lines"
            :key="i"
            class="dl"
            :class="`dl-${l.kind}`"
          >{{ l.text }}</span></pre>
      </div>
      <template v-else>
        <p v-if="view.cut" class="cut">
          <span v-if="view.fromEnd">输出过长，仅显示末尾 {{ OUTPUT_TAIL.toLocaleString() }} 字符</span>
          <span v-else>输出过长，已截断至前 {{ OUTPUT_HARD_CAP.toLocaleString() }} 字符</span>
          <button type="button" class="more" @click="showAll = !showAll">
            {{ showAll ? '只看末尾' : '展开全部' }}
          </button>
        </p>
        <pre class="out">{{ view.text }}</pre>
      </template>
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

.badge {
  font-family: var(--mono);
  font-size: 11px;
  border-radius: 4px;
  padding: 0 6px;
}

.badge.add {
  color: #86efac;
  background: rgba(34, 197, 94, 0.14);
}

.badge.del {
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.14);
}

.diff {
  margin: 0;
  padding: 6px 0;
  border-top: 1px solid var(--line-soft);
  background: #0d1424;
  color: var(--ink-dim);
  font-family: var(--mono);
  font-size: 11.5px;
  line-height: 1.5;
  max-height: 360px;
  overflow: auto;
}

/* block layout keeps every line on its own row without depending on how the
   template's whitespace is condensed */
.dl {
  display: block;
  padding: 0 12px;
  white-space: pre-wrap;
  word-break: break-all;
}

.dl-add {
  background: rgba(34, 197, 94, 0.12);
  color: #bbf7d0;
}

.dl-del {
  background: rgba(239, 68, 68, 0.12);
  color: #fecaca;
}

.dl-hunk {
  color: #93c5fd;
}

.dl-meta {
  color: var(--ink-faint);
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
