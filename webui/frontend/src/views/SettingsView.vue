<script setup lang="ts">
import { ref } from 'vue'
import { api } from '../lib/api'
import { errorMessage } from '../lib/bridge'
import { refreshConfig, store, toast } from '../store'

const emit = defineEmits<{ (e: 'close'): void }>()

const open = ref(true)
const busy = ref(false)

async function patch(patch: Record<string, unknown>): Promise<void> {
  busy.value = true
  try {
    await api.patchConfig(patch)
    await refreshConfig()
    toast('ok', '设置已保存')
  } catch (e) {
    toast('bad', errorMessage(e))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="open" class="backdrop" @click.self="emit('close')">
    <div class="panel">
      <header>
        <h3>设置</h3>
        <button class="x" @click="emit('close')">✕</button>
      </header>

      <section v-if="store.config">
        <label>思考深度</label>
        <div class="row">
          <button
            v-for="(lvl, i) in store.config.think_levels"
            :key="lvl"
            class="seg"
            :class="{ on: store.config.think_level === i }"
            @click="patch({ think_level: i })"
          >
            {{ lvl }}
          </button>
        </div>

        <label>沙箱模式</label>
        <div class="row">
          <button
            v-for="m in ['read-only', 'edit-only', 'full-access']"
            :key="m"
            class="seg"
            :class="{ on: store.config.sandbox_mode === m }"
            @click="patch({ sandbox_mode: m })"
          >
            {{ m }}
          </button>
        </div>

        <label>开关</label>
        <div class="row">
          <button
            class="seg"
            :class="{ on: store.config.tools }"
            @click="patch({ tools: !store.config.tools })"
          >
            工具调用 {{ store.config.tools ? 'ON' : 'OFF' }}
          </button>
          <button
            class="seg"
            :class="{ on: store.config.autoallow }"
            @click="patch({ autoallow: !store.config.autoallow })"
          >
            autoallow {{ store.config.autoallow ? 'ON' : 'OFF' }}
          </button>
          <button
            class="seg"
            :class="{ on: store.config.compact_auto }"
            @click="patch({ compact_auto: !store.config.compact_auto })"
          >
            自动压缩 {{ store.config.compact_auto ? 'ON' : 'OFF' }}
          </button>
        </div>

        <label>并发只读工具线程（{{ store.config.max_threads }}）</label>
        <input
          type="range"
          min="1"
          max="16"
          :value="store.config.max_threads"
          @change="patch({ max_threads: Number(($event.target as HTMLInputElement).value) })"
        />

        <p class="note">autoallow 仅在 full-access 下生效；开启后 exec 由模型自行判断是否放行。</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(3, 7, 18, 0.6);
  backdrop-filter: blur(3px);
  display: grid;
  place-items: center;
  z-index: 70;
  animation: cell-fade-in 0.12s ease both;
}

.panel {
  width: min(560px, 92vw);
  max-height: 84vh;
  overflow: auto;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 18px 20px 22px;
}

header {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

h3 {
  margin: 0;
  font-size: 16px;
}

.x {
  margin-left: auto;
  border: 0;
  background: none;
  color: var(--ink-faint);
}

label {
  display: block;
  font-size: 12px;
  color: var(--ink-dim);
  margin: 16px 0 6px;
}

.row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.seg {
  border: 1px solid var(--line);
  background: var(--bg-elev-2);
  border-radius: 999px;
  padding: 5px 14px;
  font-size: 12.5px;
  color: var(--ink-dim);
}

.seg.on {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: #bfdbfe;
}

input[type='range'] {
  width: 100%;
}

.note {
  margin: 16px 0 0;
  color: var(--ink-faint);
  font-size: 12px;
}
</style>
