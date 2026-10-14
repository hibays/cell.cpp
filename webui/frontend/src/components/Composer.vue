<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { interrupt, send, store } from '../store'

const props = defineProps<{ placeholder?: string }>()
const emit = defineEmits<{ (e: 'submit', text: string): void }>()

const text = ref('')
const box = ref<HTMLTextAreaElement | null>(null)

async function onSubmit(): Promise<void> {
  const value = text.value.trim()
  if (!value || store.streaming) return
  text.value = ''
  emit('submit', value)
  await send(value)
  await nextTick()
  box.value?.focus()
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    void onSubmit()
  }
}
</script>

<template>
  <div class="composer">
    <textarea
      ref="box"
      v-model="text"
      class="input"
      rows="1"
      :placeholder="placeholder ?? '说点什么，或输入 / 使用命令…（Enter 发送，Shift+Enter 换行）'"
      @keydown="onKeydown"
    />
    <div class="bar">
      <span v-if="store.streaming" class="state">生成中…（Esc 中断）</span>
      <span v-else class="state dim">{{ text.length }} 字</span>
      <button v-if="store.streaming" class="btn stop" @click="interrupt()">中断</button>
      <button v-else class="btn send" :disabled="!text.trim()" @click="onSubmit()">发送</button>
    </div>
  </div>
</template>

<style scoped>
.composer {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg-elev);
  padding: 10px 12px 8px;
}

.input {
  width: 100%;
  border: 0;
  outline: 0;
  resize: none;
  background: transparent;
  max-height: 180px;
  font-size: 14px;
  line-height: 1.6;
}

.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
}

.state {
  font-size: 12px;
  color: var(--accent);
}

.state.dim {
  color: var(--ink-faint);
}

.btn {
  margin-left: auto;
  border: 0;
  border-radius: var(--radius-sm);
  padding: 6px 18px;
  font-weight: 600;
  background: var(--accent);
  color: #fff;
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn.stop {
  background: rgba(239, 68, 68, 0.16);
  color: #fca5a5;
  border: 1px solid rgba(239, 68, 68, 0.35);
}

/* ---- responsive: the bar wraps instead of overflowing on phones ------- */
@media (max-width: 640px) {
  .composer {
    padding: 8px 10px;
  }
  .bar {
    flex-wrap: wrap;
    gap: 6px;
  }
  .btn {
    padding: 6px 14px;
  }
  .input {
    font-size: 16px; /* stops iOS/Android zoom-on-focus */
  }
}

</style>
