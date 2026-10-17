<script setup lang="ts">
// One transcript row: avatar, reasoning fold, markdown body, tool cards, and the
// per-message action bar.
//
// Two behaviours are worth spelling out:
//   * a *streaming* message renders through the block cache (lib/streamMarkdown)
//     so the finished paragraphs are not re-rendered on every token — the thing
//     that makes a long answer feel slow;
//   * code copy is delegated: the markdown renderer emits a `[data-copy]` button
//     per code block, and one listener here serves all of them (the alternative
//     is a Vue component per fence, which the inlined bundle cannot afford).
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { UiMessage } from '../store'
import { renderMarkdown } from '../lib/markdown'
import { createStreamRenderer } from '../lib/streamMarkdown'
import ToolCallCard from './ToolCallCard.vue'
import { formatDateTime } from '../lib/format'

const props = defineProps<{ message: UiMessage; streaming?: boolean }>()
const emit = defineEmits<{ copy: [text: string] }>()

const renderer = createStreamRenderer(renderMarkdown)
const html = computed(() =>
  props.streaming ? renderer.html(props.message.text) : renderMarkdown(props.message.text),
)
const reasoningOpen = computed(() => (props.message.reasoning?.length ?? 0) > 0)
const voted = ref<'up' | 'down' | null>(null)

const root = ref<HTMLElement | null>(null)

/** Copy through the delegation above; clipboard API with a quiet fallback. */
async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = value
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
    } catch {
      /* clipboard unavailable: the caller still shows the toast */
    }
    ta.remove()
  }
}

function onClick(e: MouseEvent): void {
  const el = (e.target as HTMLElement | null)?.closest('[data-copy]') as HTMLElement | null
  if (!el) return
  const pre = el.closest('.code-block')?.querySelector('code')
  if (!pre) return
  void copyText(pre.textContent ?? '')
  emit('copy', '代码已复制')
}

onMounted(() => root.value?.addEventListener('click', onClick))
onUnmounted(() => root.value?.removeEventListener('click', onClick))

function copyMessage(): void {
  void copyText(props.message.text)
  emit('copy', '消息已复制')
}
</script>

<template>
  <article ref="root" class="msg" :class="`role-${message.role}`">
    <div class="avatar">
      <span v-if="message.role === 'user'">你</span>
      <span v-else-if="message.role === 'assistant'" class="ai">cell</span>
      <span v-else>·</span>
    </div>
    <div class="body">
      <details v-if="reasoningOpen" class="reasoning">
        <summary>思考过程</summary>
        <div class="reasoning-body">{{ message.reasoning }}</div>
      </details>
      <div v-if="message.text" class="markdown md-body" v-html="html" />
      <!-- an empty record is a fact, not layout noise: say it instead of
           rendering an invisible row the reader reads as "nothing happened" -->
      <p v-else-if="message.empty" class="empty-note" role="note">
        （模型返回了空内容 — 该轮没有可显示的回答）
      </p>
      <span v-else-if="streaming && message.role === 'assistant'" class="cursor" />
      <ToolCallCard v-for="t in message.tools" :key="t.id" :tool="t" />

      <!-- the action bar: only on finished rows, and only what we can honour -->
      <div v-if="message.role === 'assistant' && !streaming && message.text" class="actions">
        <button type="button" title="复制这条消息" @click="copyMessage()">⧉ 复制</button>
        <button
          type="button"
          :class="{ on: voted === 'up' }"
          title="有帮助（仅本地标记，不回传）"
          @click="voted = voted === 'up' ? null : 'up'"
        >
          👍
        </button>
        <button
          type="button"
          :class="{ on: voted === 'down' }"
          title="没帮助（仅本地标记，不回传）"
          @click="voted = voted === 'down' ? null : 'down'"
        >
          👎
        </button>
        <span v-if="message.ts" class="at">{{ formatDateTime(message.ts) }}</span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.msg {
  display: flex;
  gap: 12px;
  padding: 14px 0;
  animation: cell-fade-in 0.25s ease both;
}

.avatar {
  flex: 0 0 34px;
  height: 34px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-size: var(--cell-font-size-sm);
  font-weight: 600;
  background: var(--cell-alias-bg-raised-2);
  border: 1px solid var(--cell-alias-line);
  color: var(--cell-alias-ink-dim);
}

.role-user .avatar {
  color: #c4b5fd;
}

.avatar .ai {
  color: var(--cell-alias-accent-hover);
  font-family: var(--cell-mono);
}

.body {
  min-width: 0;
  flex: 1;
}

.cursor {
  display: inline-block;
  width: 8px;
  height: 16px;
  background: var(--cell-alias-accent);
  border-radius: 2px;
  animation: cell-blink 1s steps(2) infinite;
  vertical-align: text-bottom;
}

.empty-note {
  margin: 0;
  color: var(--cell-alias-ink-faint);
  font-size: var(--cell-font-size-sm);
  font-style: italic;
  border-left: 2px solid var(--cell-alias-line);
  padding-left: 10px;
}

.reasoning {
  margin-bottom: 10px;
  border: 1px solid var(--cell-alias-line-soft);
  border-radius: var(--cell-radius-sm);
  background: var(--cell-alias-bg-raised);
  font-size: var(--cell-font-size-sm);
}

.reasoning summary {
  padding: 6px 12px;
  cursor: pointer;
  color: var(--cell-alias-ink-faint);
}

.reasoning-body {
  padding: 4px 12px 10px;
  color: var(--cell-alias-ink-dim);
  white-space: pre-wrap;
  max-height: 220px;
  overflow: auto;
}

.actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  opacity: 0;
  transition: opacity var(--cell-motion-fast);
}

.msg:hover .actions {
  opacity: 1;
}

.actions button {
  border: 1px solid transparent;
  background: none;
  color: var(--cell-alias-ink-faint);
  border-radius: var(--cell-radius-xs);
  font-size: var(--cell-font-size-xs);
  padding: 1px 7px;
}

.actions button:hover {
  border-color: var(--cell-alias-line);
  color: var(--cell-alias-ink);
}

.actions button.on {
  border-color: var(--cell-alias-accent-line);
  color: var(--cell-alias-accent);
}

.at {
  margin-left: 6px;
  color: var(--cell-alias-ink-faint);
  font-size: var(--cell-font-size-xs);
}
</style>
