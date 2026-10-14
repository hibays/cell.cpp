<script setup lang="ts">
// Agent capability panel.
//
// Everything here is backed by an endpoint that exists today: PATCH /v1/config
// for the switches, GET /v1/skills for the inventory, GET /v1/usages for spend.
// Teamwork and compaction *triggers* have no endpoint yet, so they are shown as
// configured state with a "规划中" hint instead of a control that would do
// nothing.
import { computed, onMounted, ref } from 'vue'
import { api } from '../lib/api'
import { errorMessage } from '../lib/bridge'
import { summarizeCapabilities, toRows, type Skill } from '../lib/capabilities'
import { refreshConfig, store, toast } from '../store'

const skills = ref<Skill[]>([])
const busy = ref(false)

const summary = computed(() =>
  summarizeCapabilities({
    config: store.config,
    skills: { skills: skills.value },
    usage: (store.usage ?? undefined) as never,
  }),
)

const rows = computed(() => toRows(summary.value))

onMounted(async () => {
  try {
    skills.value = (await api.skills()).skills ?? []
  } catch {
    skills.value = []
  }
})

async function patch(patch: Record<string, unknown>): Promise<void> {
  busy.value = true
  try {
    await api.patchConfig(patch)
    await refreshConfig()
    toast('ok', '已更新')
  } catch (e) {
    toast('bad', errorMessage(e))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="agent">
    <p v-for="d in summary.degraded" :key="d" class="warn">{{ d }}</p>

    <label>能力概览</label>
    <dl class="rows">
      <div v-for="r in rows" :key="r.label" class="row">
        <dt :title="r.hint">{{ r.label }}</dt>
        <dd>
          {{ r.value }}
          <span v-if="r.hint" class="planned">规划中</span>
        </dd>
      </div>
    </dl>

    <label>开关</label>
    <div class="row btns">
      <button class="seg" :class="{ on: summary.tools }" :disabled="busy" @click="patch({ tools: !summary.tools })">
        工具调用 {{ summary.tools ? 'ON' : 'OFF' }}
      </button>
      <button
        class="seg"
        :class="{ on: summary.compaction.auto }"
        :disabled="busy"
        @click="patch({ compact_auto: !summary.compaction.auto })"
      >
        自动压缩 {{ summary.compaction.auto ? 'ON' : 'OFF' }}
      </button>
    </div>

    <label>子代理上限（{{ summary.teamworkChildren }}）</label>
    <input
      type="range"
      min="0"
      max="8"
      :value="summary.teamworkChildren"
      :disabled="busy"
      @change="patch({ teamwork_max_children: Number(($event.target as HTMLInputElement).value) })"
    />

    <label>已加载技能（{{ summary.skills.length }}）</label>
    <ul v-if="summary.skills.length" class="skills">
      <li v-for="s in summary.skills" :key="s.name">
        <strong>{{ s.name }}</strong>
        <span>{{ s.description }}</span>
      </li>
    </ul>
    <p v-else class="note">.cell/skills/ 下暂无技能</p>
  </section>
</template>

<style scoped>
.agent {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

label {
  margin-top: 10px;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.rows {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
  padding: 3px 0;
  border-bottom: 1px dashed var(--line);
}

.row dt {
  color: var(--ink-dim);
}

.row dd {
  margin: 0;
  color: var(--ink);
  text-align: right;
}

.planned {
  margin-left: 6px;
  font-size: 10px;
  padding: 0 5px;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--ink-faint);
}

.btns {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  border-bottom: none;
}

.seg {
  border: 1px solid var(--line);
  background: transparent;
  color: var(--ink-dim);
  border-radius: 8px;
  padding: 4px 10px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.seg.on {
  border-color: var(--accent, #60a5fa);
  color: var(--ink);
  background: rgba(96, 165, 250, 0.12);
}

.skills {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 170px;
  overflow-y: auto;
}

.skills li {
  display: flex;
  gap: 8px;
  font-size: 12px;
  color: var(--ink-dim);
}

.skills strong {
  color: var(--ink);
  min-width: 90px;
}

.warn {
  margin: 0;
  font-size: 12px;
  color: #fca5a5;
}

.note {
  margin: 0;
  font-size: 11.5px;
  color: var(--ink-faint);
}
</style>
