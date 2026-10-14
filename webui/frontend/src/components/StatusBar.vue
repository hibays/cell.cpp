<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from '../lib/api'
import { store } from '../store'
import { formatNumber } from '../lib/format'
import { createConnection, type ConnectionState } from '../lib/connection'
import { classifyError, type CellErrorView } from '../lib/errors'
import { fromKernelConfig, PRESETS } from '../lib/permissions'

interface Health {
  status: string
  version: string
  provider: string
  model: string
  sandbox_mode: string
  turn_active: boolean
  uptime_s: number
}

const health = ref<Health | null>(null)
const conn = createConnection()
const connState = ref<ConnectionState>(conn.state)
const failure = ref<CellErrorView | null>(null)
let timer = 0

// The fence is rendered from a normalised selection, so the pill shows the same
// vocabulary as the settings control instead of a raw kernel string.
const fenceLabel = computed(() => {
  if (!health.value) return ''
  const sel = fromKernelConfig({ sandbox_mode: health.value.sandbox_mode })
  if (sel.preset === 'custom') return sel.sandbox
  return PRESETS[sel.preset as 'safe' | 'standard' | 'auto']?.name ?? sel.sandbox
})

const pillText = computed(() => {
  if (connState.value === 'connected') return '内核在线'
  if (connState.value === 'connecting') return '连接中'
  return '内核离线'
})

async function poll(): Promise<void> {
  try {
    health.value = (await api.health()) as Health
    conn.markConnected()
    failure.value = null
  } catch (e) {
    // route on code, never on message: the same taxonomy the chat surface uses
    const view = classifyError(e)
    health.value = null
    failure.value = view
    conn.markDisconnected(view.title)
  }
}

onMounted(() => {
  conn.onStateChange((s) => {
    connState.value = s
  })
  void poll()
  timer = window.setInterval(() => void poll(), 5000)
})

onUnmounted(() => window.clearInterval(timer))
</script>

<template>
  <div class="statusbar">
    <span class="pill" :class="connState === 'connected' ? 'ok' : connState === 'connecting' ? 'warn' : 'bad'">
      {{ pillText }}
    </span>
    <span v-if="health" class="model">{{ health.provider }}:{{ health.model }}</span>
    <span v-if="health" class="mode" :title="`sandbox: ${health.sandbox_mode}`">{{ fenceLabel }}</span>
    <span v-if="failure" class="err" :title="failure.hint">
      {{ failure.title }}
    </span>
    <button v-if="failure?.retryable" class="retry" type="button" @click="void poll()">重试</button>
    <span class="spacer" />
    <span class="usage"
      >tokens {{ formatNumber(store.usage?.tok_in) }}↑ {{ formatNumber(store.usage?.tok_out) }}↓</span
    >
  </div>
</template>

<style scoped>
.statusbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  border-top: 1px solid var(--line);
  background: var(--bg-elev);
  font-size: 11.5px;
  color: var(--ink-dim);
  font-family: var(--mono);
}

.pill {
  border-radius: 999px;
  padding: 1px 9px;
  font-weight: 600;
}

.pill.ok {
  background: rgba(34, 197, 94, 0.14);
  color: #86efac;
}

.pill.bad {
  background: rgba(239, 68, 68, 0.14);
  color: #fca5a5;
}

.pill.warn {
  background: rgba(234, 179, 8, 0.16);
  color: #fde047;
}

.mode {
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 0 8px;
  color: var(--ink-dim);
}

.err {
  color: #fca5a5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 42%;
}

.retry {
  border: 1px solid var(--line);
  border-radius: 6px;
  background: transparent;
  color: var(--ink-dim);
  font: inherit;
  padding: 0 8px;
  cursor: pointer;
}

.retry:hover {
  color: var(--ink);
  border-color: var(--ink-faint);
}

.spacer {
  flex: 1;
}

.usage {
  color: var(--ink-faint);
}
</style>
