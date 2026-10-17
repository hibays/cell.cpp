<script setup lang="ts">
// The strip under the composer: kernel state on the left, telemetry on the right.
//
// Numbers policy — every figure here comes from the kernel, or from the
// transcript, and anything unknown renders as a dash rather than a plausible
// zero:
//   * turns / steps   derived from the transcript (lib/stats.ts)
//   * tokens, cache   from /v1/usages (session scope, install scope in the tooltip)
//   * while a turn is streaming, elapsed time and streamed characters are shown
//     instead of a tok/s we cannot honestly compute client-side.
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { api } from '../lib/api'
import { store } from '../store'
import { cacheHitRatio, transcriptStats } from '../lib/stats'
import { emptyLiveTurn, liveCacheHit, liveText, liveTokensPerSecond } from '../lib/liveTurn'
import { formatCompact, formatPercent, formatRate } from '../lib/format'
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

const stats = computed(() => transcriptStats(store.messages))
const sessionUsage = computed(() => store.usage?.session ?? null)
const cacheHit = computed(() => {
  const u = sessionUsage.value
  return u ? cacheHitRatio(u) : undefined
})

// While a turn runs the live figures win: they describe the request that is
// happening, and the session counters only move when it lands.
const liveEmpty = emptyLiveTurn()
const liveRate = computed(() => (store.live ? liveTokensPerSecond(store.live) : undefined))
const liveHit = computed(() => (store.live ? liveCacheHit(store.live) : undefined))
const shownHit = computed(() => (store.streaming ? liveHit.value : cacheHit.value))
const shownTokens = computed(() => {
  if (store.streaming && store.live?.usage) return store.live.usage.totalTokens
  return sessionUsage.value?.totalTokens
})

// Context occupancy of the newest request: the kernel's contextWindow /
// contextPressure pair. It is last-wins (not summed) and only appears once the
// kernel has reported the denominator, so an unknown window renders nothing
// rather than a plausible zero.
const contextUsage = computed(() => store.live?.usage ?? null)
const contextLabel = computed(() => {
  const u = contextUsage.value
  if (!u || !u.contextWindow) return ''
  return `ctx ${u.contextPct ?? 0}%`
})
const contextHint = computed(() => {
  const u = contextUsage.value
  if (!u || !u.contextWindow) return ''
  return `上下文占用 ${formatCompact(u.contextTokens ?? 0)} / ${formatCompact(u.contextWindow)} tokens（${u.contextPct ?? 0}%）`
})

/** Install-wide totals, for the tooltip — the strip itself is session-scoped. */
const installHint = computed(() => {
  const all = store.usage?.all
  if (!all) return '用量统计尚不可用'
  const hit = cacheHitRatio(all)
  return [
    `安装合计：${all.requests} 次请求`,
    `${formatCompact(all.inputTokens)} ↑ / ${formatCompact(all.outputTokens)} ↓ tokens`,
    `缓存命中 ${hit === undefined ? '—' : formatPercent(hit)}`,
  ].join('\n')
})

/** Live elapsed seconds while a turn streams (the strip's only time-based figure). */
const elapsed = ref(0)
let elapsedTimer = 0

// A slow kernel must not stack health requests: the interval, the retry button
// and a manual poll would otherwise all be in flight at once, which is exactly
// when the kernel is least able to answer.
let polling = false

async function poll(): Promise<void> {
  if (polling) return
  polling = true
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
  } finally {
    polling = false
  }
}

let unsubscribe: (() => void) | null = null

onMounted(() => {
  unsubscribe = conn.onStateChange((s) => {
    connState.value = s
  })
  void poll()
  timer = window.setInterval(() => void poll(), 5000)
  elapsedTimer = window.setInterval(() => {
    elapsed.value = store.streaming ? Math.floor((Date.now() - store.streamStartedAt) / 1000) : 0
  }, 500)
})

onUnmounted(() => {
  window.clearInterval(timer)
  window.clearInterval(elapsedTimer)
  unsubscribe?.()
})
</script>

<template>
  <footer class="strip">
    <span class="pill" :class="connState">
      <span class="dot" />
      {{ pillText }}
    </span>
    <span v-if="health" class="item mono">{{ health.provider }}:{{ health.model }}</span>
    <span v-if="fenceLabel" class="item" :title="`沙箱模式：${health?.sandbox_mode}`">🛡 {{ fenceLabel }}</span>

    <span class="spacer" />

    <span v-if="failure" class="item bad" :title="failure.hint">
      {{ failure.title }}
      <button class="retry" @click="poll()">重试</button>
    </span>

    <span v-if="store.streaming" class="item live">
      <span class="pulse" />
      输出中 · {{ elapsed }}s · {{ formatCompact(liveText(store.live ?? liveEmpty).length) }} 字
      <span v-if="liveRate !== undefined" class="dim">· {{ formatRate(liveRate) }}</span>
    </span>

    <span class="item" title="本会话的轮次与工具调用步数">
      {{ stats.turns }} 轮 {{ stats.steps }} 步
    </span>
    <span class="item" :title="installHint">
      {{ shownTokens === undefined ? '—' : formatCompact(shownTokens) }} tok
      <span class="dim">缓存命中 {{ shownHit === undefined ? '—' : formatPercent(shownHit) }}</span>
    </span>
    <span v-if="contextLabel" class="item" :title="contextHint">
      {{ contextLabel }}
      <span class="dim">
        {{ formatCompact(contextUsage?.contextTokens ?? 0) }}/{{ formatCompact(contextUsage?.contextWindow ?? 0) }}
      </span>
    </span>
    <span v-if="health" class="item mono dim" :title="`版本 ${health.version} · 会话 ${store.currentSession ?? '—'}`">
      {{ health.version }} · {{ store.currentSession?.slice(-6) ?? '—' }}
    </span>
  </footer>
</template>

<style scoped>
.strip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px;
  border-top: 1px solid var(--cell-alias-line-soft);
  background: var(--cell-alias-bg-raised);
  font-size: var(--cell-font-size-xs);
  color: var(--cell-alias-ink-dim);
  min-height: 30px;
}

.spacer {
  flex: 1;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--cell-alias-line);
  border-radius: var(--cell-radius-pill);
  padding: 1px 9px;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cell-alias-ink-faint);
}

.pill.connected .dot {
  background: var(--cell-alias-ok);
}

.pill.connecting .dot {
  background: var(--cell-alias-warn);
}

.pill.disconnected .dot {
  background: var(--cell-alias-bad);
}

.item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.item.mono {
  font-family: var(--cell-mono);
}

.item.dim,
.dim {
  color: var(--cell-alias-ink-faint);
}

.item.bad {
  color: var(--cell-alias-bad);
}

.item.live {
  color: var(--cell-alias-accent);
}

.pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cell-alias-accent);
  animation: cell-pulse 1.2s ease-in-out infinite;
}

.retry {
  border: 1px solid var(--cell-alias-line);
  border-radius: var(--cell-radius-pill);
  background: none;
  color: inherit;
  font-size: var(--cell-font-size-xs);
  padding: 0 8px;
}

.retry:hover {
  border-color: var(--cell-alias-accent);
  color: var(--cell-alias-ink);
}
</style>
