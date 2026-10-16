<script setup lang="ts">
// Who let this session run what.
//
// The kernel writes an audit line next to the transcript for every decision, so
// this is a read: no polling while nothing happens, a refresh right after each
// decision, and the risk marking uses the same rule as the live approval card
// (lib/approvals.ts) so the two cannot drift apart.
import { computed, onMounted, ref } from 'vue'
import { refreshApprovals, store } from '../store'
import { approvalStats, decisionLabel, decisionTone, riskOf, summarizeArgs } from '../lib/approvals'
import { formatDateTime } from '../lib/format'

const open = ref(false)
const onlyDenied = ref(false)

const rows = computed(() => {
  const all = store.approvalsLog ?? []
  return onlyDenied.value ? all.filter((r) => r.decision !== 'allow') : all
})
const stats = computed(() => approvalStats(store.approvalsLog ?? []))

onMounted(() => {
  if (!store.approvalsLog.length) void refreshApprovals()
})
</script>

<template>
  <section class="approvals">
    <header class="turn-head" @click="open = !open">
      <span class="caret">{{ open ? '▾' : '▸' }}</span>
      <span class="idx">审批</span>
      <span v-if="stats.total" class="chip">
        {{ stats.total }} 次 · 允许 {{ stats.allowed }} · 拒绝 {{ stats.denied }}
        <template v-if="stats.highRisk"> · 高风险 {{ stats.highRisk }}</template>
      </span>
      <span class="spacer" />
      <button
        v-if="open && stats.denied"
        class="mini"
        type="button"
        :title="onlyDenied ? '显示全部' : '只看拒绝的'"
        @click.stop="onlyDenied = !onlyDenied"
      >
        {{ onlyDenied ? '全部' : '只看拒绝' }}
      </button>
    </header>

    <div v-if="open" class="body">
      <p v-if="!rows.length" class="empty">
        {{ onlyDenied ? '这一会话没有被拒绝的工具调用。' : '这一会话还没有需要审批的工具调用。' }}
      </p>
      <div v-for="r in rows" :key="r.id" class="row" :class="[decisionTone(r.decision), { hot: riskOf(`${r.tool} ${summarizeArgs(r.args)}`) === 'high' }]">
        <span class="when">{{ formatDateTime(r.at) }}</span>
        <span class="verdict">{{ decisionLabel(r.decision) }}</span>
        <span class="tool">{{ r.tool }}</span>
        <span class="what" :title="r.args">{{ summarizeArgs(r.args) }}</span>
        <span v-if="r.reason" class="why" :title="r.reason">理由：{{ r.reason }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.approvals {
  border-bottom: 1px solid var(--cell-alias-line-soft);
}

.body {
  padding: 8px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.spacer {
  flex: 1;
}

.mini {
  border: 1px solid var(--cell-alias-line);
  border-radius: var(--cell-radius-xs);
  background: var(--cell-alias-bg-raised);
  color: var(--cell-alias-ink-dim);
  font-size: var(--cell-font-size-xs);
  padding: 1px 8px;
}

.row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: var(--cell-font-size-xs);
  border-left: 2px solid transparent;
  padding: 2px 0 2px 8px;
}

.row.ok {
  border-left-color: var(--cell-alias-good);
}

.row.bad {
  border-left-color: var(--cell-alias-bad);
}

.row.hot .what {
  color: var(--cell-alias-bad);
}

.when {
  color: var(--cell-alias-ink-faint);
  white-space: nowrap;
}

.verdict {
  white-space: nowrap;
}

.row.ok .verdict {
  color: var(--cell-alias-good);
}

.row.bad .verdict {
  color: var(--cell-alias-bad);
}

.tool {
  font-family: var(--cell-mono);
  color: var(--cell-alias-ink-dim);
  white-space: nowrap;
}

.what {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--cell-mono);
  color: var(--cell-alias-ink);
}

.why {
  color: var(--cell-alias-ink-faint);
  max-width: 30%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  color: var(--cell-alias-ink-faint);
  font-size: var(--cell-font-size-sm);
}
</style>