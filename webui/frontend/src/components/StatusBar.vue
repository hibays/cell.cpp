<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { api } from '../lib/api'
import { store } from '../store'
import { formatNumber } from '../lib/format'

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
let timer = 0

async function poll(): Promise<void> {
  try {
    health.value = (await api.health()) as Health
  } catch {
    health.value = null
  }
}

onMounted(() => {
  void poll()
  timer = window.setInterval(() => void poll(), 5000)
})

onUnmounted(() => window.clearInterval(timer))
</script>

<template>
  <div class="statusbar">
    <span class="pill" :class="health ? 'ok' : 'bad'">
      {{ health ? '内核在线' : '内核离线' }}
    </span>
    <span v-if="health" class="model">{{ health.provider }}:{{ health.model }}</span>
    <span v-if="health" class="mode">{{ health.sandbox_mode }}</span>
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

.spacer {
  flex: 1;
}

.usage {
  color: var(--ink-faint);
}
</style>
