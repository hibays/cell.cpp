<script setup lang="ts">
import { computed } from 'vue'
import type { UiMessage } from '../store'
import { renderMarkdown } from '../lib/markdown'
import ToolCallCard from './ToolCallCard.vue'

const props = defineProps<{ message: UiMessage; streaming?: boolean }>()

const html = computed(() =>
  props.streaming ? renderMarkdown(props.message.text) : renderMarkdown(props.message.text),
)
const reasoningOpen = computed(() => (props.message.reasoning?.length ?? 0) > 0)
</script>

<template>
  <article class="msg" :class="`role-${message.role}`">
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
      <span v-else-if="streaming && message.role === 'assistant'" class="cursor" />
      <ToolCallCard v-for="t in message.tools" :key="t.id" :tool="t" />
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
  font-size: 12px;
  font-weight: 600;
  background: var(--bg-elev-2);
  border: 1px solid var(--line);
  color: var(--ink-dim);
}

.role-user .avatar {
  color: #c4b5fd;
}

.avatar .ai {
  color: #60a5fa;
  font-family: var(--mono);
}

.body {
  min-width: 0;
  flex: 1;
}

.cursor {
  display: inline-block;
  width: 8px;
  height: 16px;
  background: var(--accent);
  border-radius: 2px;
  animation: cell-blink 1s steps(2) infinite;
  vertical-align: text-bottom;
}

.reasoning {
  margin-bottom: 10px;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  background: var(--bg-elev);
  font-size: 12px;
}

.reasoning summary {
  padding: 6px 12px;
  cursor: pointer;
  color: var(--ink-faint);
}

.reasoning-body {
  padding: 4px 12px 10px;
  color: var(--ink-dim);
  white-space: pre-wrap;
  max-height: 220px;
  overflow: auto;
}
</style>
