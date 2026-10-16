<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import type { Approval } from '../lib/api'
import { approve, deny, store } from '../store'

const props = defineProps<{ approval: Approval }>()

const argsText = computed(() => {
  try {
    const parsed = JSON.parse(props.approval.args) as { cmd?: string }
    if (parsed.cmd) return parsed.cmd
  } catch {
    /* not JSON */
  }
  return props.approval.args
})

const risk = computed<'high' | 'normal'>(() => {
  const cmd = argsText.value
  return /rm\s+-rf|chmod|sudo|git\s+(push|reset)|:\(\)\{/.test(cmd) ? 'high' : 'normal'
})

const queue = computed(() => store.approvals.findIndex((a) => a.request_id === props.approval.request_id) + 1)
/** Only the head of the queue answers the keyboard. */
const isHead = computed(() => store.approvals[0]?.request_id === props.approval.request_id)

// Y / N, since the card prints them: the old card advertised a shortcut that
// did nothing. Typing targets are left alone (the sidebar search is a live
// input; the composer itself is disabled while a decision is pending).
function onKey(e: KeyboardEvent): void {
  if (!isHead.value || e.metaKey || e.ctrlKey || e.altKey) return
  const el = e.target as HTMLElement | null
  if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)) return
  const k = e.key.toLowerCase()
  if (k === 'y') {
    e.preventDefault()
    void approve(props.approval.request_id)
  } else if (k === 'n') {
    e.preventDefault()
    void deny(props.approval.request_id)
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="approval" :class="`risk-${risk}`">
    <div class="head">
      <span class="tool">{{ approval.tool }}</span>
      <span v-if="queue > 1" class="queue">队列 #{{ queue }}</span>
      <span class="risk">{{ risk === 'high' ? '高风险' : '需要确认' }}</span>
    </div>
    <pre class="cmd">{{ argsText }}</pre>
    <div class="actions">
      <button class="deny" @click="deny(approval.request_id)">拒绝 <kbd>N</kbd></button>
      <button class="allow" @click="approve(approval.request_id)">允许 <kbd>Y</kbd></button>
    </div>
  </div>
</template>

<style scoped>
.approval {
  margin: 10px 0;
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: var(--radius);
  background: rgba(245, 158, 11, 0.07);
  padding: 12px 14px;
}

.risk-high {
  border-color: rgba(239, 68, 68, 0.45);
  background: rgba(239, 68, 68, 0.08);
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.tool {
  font-family: var(--mono);
  color: #fcd34d;
}

.queue {
  color: var(--ink-faint);
}

.risk {
  margin-left: auto;
  border: 1px solid currentColor;
  border-radius: 999px;
  padding: 0 8px;
  font-size: 11px;
  color: var(--warn);
}

.risk-high .risk {
  color: var(--bad);
}

.cmd {
  margin: 8px 0 12px;
  font-family: var(--mono);
  font-size: 12.5px;
  color: var(--ink);
  white-space: pre-wrap;
  word-break: break-all;
}

.actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

button {
  border-radius: var(--radius-sm);
  border: 1px solid var(--line);
  padding: 6px 16px;
  background: var(--bg-elev-2);
  transition: filter 0.12s ease;
}

button:hover {
  filter: brightness(1.2);
}

.allow {
  background: rgba(34, 197, 94, 0.16);
  border-color: rgba(34, 197, 94, 0.4);
  color: #86efac;
}

.deny {
  background: rgba(239, 68, 68, 0.14);
  border-color: rgba(239, 68, 68, 0.35);
  color: #fca5a5;
}

kbd {
  font-family: var(--mono);
  font-size: 10px;
  opacity: 0.7;
}
</style>
