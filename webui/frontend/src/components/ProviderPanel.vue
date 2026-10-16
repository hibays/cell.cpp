<script setup lang="ts">
// Provider management.
//
// The kernel has served the whole provider surface for a while
// (docs/RESTful.md §3.4): list, create/update, delete, select, and probe the
// model's own model list. Until now the only way to reach any of it from the
// shell was the onboarding form, which appears exactly once — so a second
// endpoint, a rotated key or a provider you do not want any more had nowhere to
// go. This panel is that surface, and nothing more: every button here is one
// endpoint, with its own guards.
//
// It also says *where the settings live* and whether that place can be written,
// because a provider that cannot be persisted is the difference between
// configuring once and configuring on every launch.
import { computed, ref } from 'vue'
import { api } from '../lib/api'
import { friendlyError } from '../lib/friendly'
import { refreshConfig, store, toast } from '../store'
import type { ProviderEntry } from '../lib/api'

const props = defineProps<{ root?: string; rootWritable?: boolean }>()

const STYLES = [
  { value: 'openai-chat', label: 'OpenAI 兼容（/chat/completions）' },
  { value: 'openai-responses', label: 'OpenAI Responses（/responses）' },
  { value: 'anthropic', label: 'Anthropic（/messages）' },
] as const

const name = ref('')
const style = ref<string>('openai-chat')
const base = ref('')
const proxy = ref('')
const key = ref('')
const model = ref('')
const models = ref<string[]>([])
const busy = ref(false)
const probing = ref(false)
/** the provider whose key field is open, if any */
const keyFor = ref<string | null>(null)
const keyDraft = ref('')

const providers = computed(() => store.providers)

async function probe(): Promise<void> {
  if (!base.value.trim() || probing.value) return
  probing.value = true
  models.value = []
  try {
    // the probe registers first: without a key a local gateway still answers,
    // and the endpoint needs a named provider to ask
    const p = await api.createProvider({
      api_style: style.value,
      name: name.value.trim() || style.value,
      base: base.value.trim(),
    })
    models.value = (await api.providerModels(p.name)).models ?? []
    if (models.value.length && !model.value) model.value = models.value[0]
    toast('ok', `该端点报告了 ${models.value.length} 个模型`)
  } catch (e) {
    toast('bad', `探测失败：${friendlyError(e)}`)
  } finally {
    probing.value = false
  }
}

async function save(): Promise<void> {
  if (!base.value.trim() || busy.value) return
  busy.value = true
  try {
    await api.createProvider({
      api_style: style.value,
      name: name.value.trim() || style.value,
      base: base.value.trim(),
      proxy: proxy.value.trim() || undefined,
      key: key.value.trim() || undefined,
      model: model.value.trim() || undefined,
    })
    toast('ok', '已保存（写入 .cell/config.json 与凭据库）')
    name.value = ''
    base.value = ''
    proxy.value = ''
    key.value = ''
    model.value = ''
    models.value = []
    await refreshConfig()
  } catch (e) {
    // the kernel answers config_unwritable when the runtime root refuses writes
    toast('bad', `保存失败：${friendlyError(e)}`)
  } finally {
    busy.value = false
  }
}

async function useProvider(p: ProviderEntry): Promise<void> {
  try {
    await api.selectProvider(p.name, model.value.trim() || undefined)
    toast('ok', `已切换到 ${p.name}`)
    await refreshConfig()
  } catch (e) {
    toast('bad', `切换失败：${friendlyError(e)}`)
  }
}

async function rotateKey(p: ProviderEntry): Promise<void> {
  if (keyFor.value !== p.name) {
    keyFor.value = p.name
    keyDraft.value = ''
    return
  }
  try {
    await api.createProvider({ name: p.name, key: keyDraft.value.trim() })
    toast('ok', `${p.name} 的密钥已更新`)
    keyFor.value = null
    await refreshConfig()
  } catch (e) {
    toast('bad', `更新密钥失败：${friendlyError(e)}`)
  }
}

async function removeProvider(p: ProviderEntry): Promise<void> {
  if (!confirm(`删除服务商「${p.name}」？密钥会一并移除。`)) return
  try {
    await api.deleteProvider(p.name)
    toast('ok', `已删除 ${p.name}`)
    await refreshConfig()
  } catch (e) {
    toast('bad', `删除失败：${friendlyError(e)}`)
  }
}
</script>

<template>
  <div class="providers">
    <!-- where the settings live, and whether they can be written -->
    <p class="root" :class="{ bad: props.rootWritable === false }">
      数据目录：<code>{{ props.root || '（未知）' }}</code>
      <template v-if="props.rootWritable === false">
        — <strong>不可写，设置无法保存</strong>（每次启动都要重新配置就是这个原因）
      </template>
    </p>

    <div class="list">
      <div v-for="p in providers" :key="p.name" class="row" :class="{ on: p.current }">
        <div class="head">
          <span class="name">{{ p.name }}</span>
          <span class="tag">{{ p.api_style }}</span>
          <span v-if="p.current" class="tag live">使用中</span>
          <span v-if="!p.key_set" class="tag warn">无密钥</span>
        </div>
        <div class="base" :title="p.base">{{ p.base || '（未设置端点）' }}</div>
        <div class="acts">
          <button v-if="!p.current" class="mini" type="button" @click="useProvider(p)">设为当前</button>
          <button class="mini" type="button" @click="rotateKey(p)">
            {{ keyFor === p.name ? '保存密钥' : '换密钥' }}
          </button>
          <button class="mini danger" type="button" @click="removeProvider(p)">删除</button>
        </div>
        <input
          v-if="keyFor === p.name"
          v-model="keyDraft"
          class="keyin"
          type="password"
          placeholder="新的 API 密钥（保存在凭据库，不在 config.json 里）"
          @keydown.enter="rotateKey(p)"
        />
      </div>
      <p v-if="!providers.length" class="empty">还没有登记任何服务商。下面加一个。</p>
    </div>

    <div class="adder">
      <h4>添加 / 更新服务商</h4>
      <div class="grid">
        <input v-model="name" placeholder="名称（留空则用接口风格名）" />
        <select v-model="style">
          <option v-for="s in STYLES" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
      </div>
      <input v-model="base" placeholder="端点，如 https://api.deepseek.com/v1" />
      <p class="hint">
        本地服务（<code>127.0.0.1</code> / <code>localhost</code>，如 Ollama、llama.cpp、vLLM）<strong>不需要密钥</strong>，留空即可。
        OpenAI 兼容服务的地址要带到 <code>/v1</code>：Ollama 填
        <code>http://127.0.0.1:11434/v1</code>，只填到端口会得到 404。
      </p>
      <div class="grid">
        <input v-model="proxy" placeholder="代理（可选），如 http://127.0.0.1:7890" />
        <input v-model="model" placeholder="模型（可选）" />
      </div>
      <input v-model="key" type="password" placeholder="API 密钥（可选；存在凭据库里）" />
      <div class="acts">
        <button class="mini" type="button" :disabled="probing" @click="probe">探测模型列表</button>
        <span class="spacer" />
        <span v-if="models.length" class="dim">{{ models.length }} 个模型可选</span>
        <button class="mini primary" type="button" :disabled="busy || !base.trim()" @click="save">
          保存
        </button>
      </div>
      <select v-if="models.length" v-model="model" class="models">
        <option v-for="m in models" :key="m" :value="m">{{ m }}</option>
      </select>
    </div>
  </div>
</template>

<style scoped>
.providers {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.root {
  margin: 0;
  font-size: var(--cell-font-size-xs);
  color: var(--cell-alias-ink-faint);
  line-height: 1.6;
}

.root code {
  font-family: var(--cell-mono);
  color: var(--cell-alias-ink-dim);
}

.root.bad {
  color: var(--cell-alias-bad);
}

.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.row {
  border: 1px solid var(--cell-alias-line-soft);
  border-radius: var(--cell-radius-sm);
  padding: 8px 10px;
  background: var(--cell-alias-bg-base);
}

.row.on {
  border-color: var(--cell-alias-accent-line);
}

.head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.name {
  font-family: var(--cell-mono);
  color: var(--cell-alias-ink);
}

.tag {
  font-size: var(--cell-font-size-xs);
  color: var(--cell-alias-ink-faint);
  border: 1px solid var(--cell-alias-line-soft);
  border-radius: var(--cell-radius-pill);
  padding: 0 6px;
}

.tag.live {
  color: var(--cell-alias-accent);
  border-color: var(--cell-alias-accent-line);
}

.tag.warn {
  color: var(--cell-alias-warn);
  border-color: var(--cell-alias-warn);
}

.base {
  font-family: var(--cell-mono);
  font-size: var(--cell-font-size-xs);
  color: var(--cell-alias-ink-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 3px 0;
}

.acts {
  display: flex;
  align-items: center;
  gap: 6px;
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
  padding: 2px 8px;
}

.mini:hover:not(:disabled) {
  border-color: var(--cell-alias-accent-line);
  color: var(--cell-alias-ink);
}

.mini.primary {
  border-color: var(--cell-alias-accent-line);
  color: var(--cell-alias-accent);
}

.mini.danger:hover {
  border-color: var(--cell-alias-bad);
  color: var(--cell-alias-bad);
}

.mini:disabled {
  opacity: 0.5;
}

.keyin,
.adder input,
.adder select {
  border: 1px solid var(--cell-alias-line);
  border-radius: var(--cell-radius-xs);
  background: var(--cell-alias-bg-raised);
  color: var(--cell-alias-ink);
  font-size: var(--cell-font-size-xs);
  padding: 4px 8px;
  width: 100%;
}

.keyin {
  margin-top: 6px;
}

.adder {
  border-top: 1px solid var(--cell-alias-line-soft);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.adder h4 {
  margin: 0;
  font-size: var(--cell-font-size-sm);
  color: var(--cell-alias-ink-dim);
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.models {
  width: 100%;
}

.empty,
.dim {
  font-size: var(--cell-font-size-xs);
  color: var(--cell-alias-ink-faint);
  margin: 0;
}

.hint {
  margin: 0;
  font-size: var(--cell-font-size-xs);
  color: var(--cell-alias-ink-faint);
  line-height: 1.7;
}

.hint code {
  font-family: var(--cell-mono);
  color: var(--cell-alias-ink-dim);
}

.hint strong {
  color: var(--cell-alias-ink-dim);
}
</style>
