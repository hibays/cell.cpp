<script setup lang="ts">
import { ref } from 'vue'
import { api } from '../lib/api'
import { errorMessage } from '../lib/bridge'
import { refreshConfig, store, toast } from '../store'

const styles = [
  { value: 'openai-chat', label: 'OpenAI Chat（兼容网关）' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic', label: 'Anthropic Messages' },
]

const style = ref('openai-chat')
const base = ref('')
const key = ref('')
const model = ref('')
const name = ref('')
const saving = ref(false)
const probing = ref(false)
const models = ref<string[]>([])

async function save(): Promise<void> {
  if (!base.value.trim()) {
    toast('warn', '请填写 API Base URL')
    return
  }
  saving.value = true
  try {
    await api.createProvider({
      api_style: style.value,
      base: base.value.trim(),
      key: key.value.trim(),
      model: model.value.trim(),
      name: name.value.trim() || undefined,
    })
    await refreshConfig()
    toast('ok', 'provider 已保存到加密保险库')
    store.phase = 'app'
  } catch (e) {
    toast('bad', errorMessage(e))
  } finally {
    saving.value = false
  }
}

async function probe(): Promise<void> {
  if (!base.value.trim()) return
  probing.value = true
  models.value = []
  try {
    // register first (without a key the probe still answers for local gateways)
    await api.createProvider({ api_style: style.value, base: base.value.trim() }).catch(() => {})
    await refreshConfig()
    const p = store.providers[0]
    if (p) models.value = (await api.providerModels(p.name)).models
  } catch (e) {
    toast('warn', `探测失败：${errorMessage(e)}`)
  } finally {
    probing.value = false
  }
}
</script>

<template>
  <div class="onboard">
    <div class="card">
      <h2>连接你的模型</h2>
      <p class="desc">密钥写入本地加密保险库（.cell/.crypt），不会离开这台机器。</p>

      <label>API 风格</label>
      <select v-model="style">
        <option v-for="s in styles" :key="s.value" :value="s.value">{{ s.label }}</option>
      </select>

      <label>Base URL</label>
      <input
        v-model="base"
        placeholder="https://api.openai.com/v1 或 http://localhost:11434/v1"
        spellcheck="false"
      />

      <label>模型</label>
      <input v-model="model" placeholder="gpt-4o / qwen2.5-coder / …" spellcheck="false" />

      <label>API Key（可留空，使用环境变量）</label>
      <input v-model="key" type="password" placeholder="sk-…" autocomplete="off" />

      <label>名称（可选）</label>
      <input v-model="name" placeholder="openai" spellcheck="false" />

      <div class="actions">
        <button class="ghost" :disabled="probing || !base.trim()" @click="probe()">
          {{ probing ? '探测中…' : '探测模型列表' }}
        </button>
        <button class="primary" :disabled="saving" @click="save()">
          {{ saving ? '保存中…' : '保存并进入' }}
        </button>
      </div>

      <div v-if="models.length" class="models">
        <span v-for="m in models" :key="m" class="chip" @click="model = m">{{ m }}</span>
      </div>
      <p class="hint">
        本地服务（<code>127.0.0.1</code> / <code>localhost</code>，如 Ollama、vLLM）不需要密钥，Key 留空即可。
        OpenAI 兼容地址要带到 <code>/v1</code>：Ollama 是 <code>http://127.0.0.1:11434/v1</code>，只填到端口会得到 404。
      </p>
    </div>
  </div>
</template>

<style scoped>
.onboard {
  height: 100%;
  display: grid;
  place-items: center;
  padding: 24px;
  background: radial-gradient(120% 90% at 20% 0%, #14213d 0%, var(--bg) 55%);
}

.card {
  width: min(520px, 100%);
  background: var(--bg-elev);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 26px 28px;
  animation: cell-fade-in 0.35s ease both;
}

h2 {
  margin: 0 0 4px;
  font-size: 20px;
}

.desc {
  margin: 0 0 18px;
  color: var(--ink-dim);
  font-size: 13px;
}

label {
  display: block;
  font-size: 12px;
  color: var(--ink-dim);
  margin: 12px 0 4px;
}

input,
select {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--bg);
  padding: 8px 10px;
  outline: none;
}

input:focus,
select:focus {
  border-color: var(--accent);
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}

.primary {
  margin-left: auto;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
  padding: 8px 20px;
  font-weight: 600;
}

.ghost {
  border: 1px solid var(--line);
  background: var(--bg-elev-2);
  border-radius: var(--radius-sm);
  padding: 8px 16px;
  color: var(--ink-dim);
}

.models {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 14px;
}

.chip {
  font-family: var(--mono);
  font-size: 11.5px;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 2px 10px;
  color: var(--ink-dim);
  cursor: pointer;
}

.chip:hover {
  border-color: var(--accent);
  color: var(--ink);
}

.hint {
  margin-top: 14px;
  color: var(--ink-faint);
  font-size: 12px;
}
</style>
