<script setup lang="ts">
// Trace view: the transcript folded into turns and steps.
//
// This is the 轨迹 half of the header's view switch. It answers "what did the
// agent actually do" for any session — including historical ones — because it
// derives everything from the transcript (lib/trace.ts) instead of from the
// live stream. Tool steps reuse ToolCallCard so diffs, exit codes and output
// clipping have exactly one renderer.
import { computed, ref } from 'vue'
import SubAgents from '../components/SubAgents.vue'
import { store } from '../store'
import ToolCallCard from '../components/ToolCallCard.vue'
import { buildTurns, turnStatus, type TraceStep } from '../lib/trace'
import type { UiToolCall } from '../lib/transcript'
import { relativeTime, truncate } from '../lib/format'
import { renderMarkdown } from '../lib/markdown'

const turns = computed(() => buildTurns(store.messages))
const folded = ref<Record<string, boolean>>({})

function toggle(key: string): void {
  folded.value = { ...folded.value, [key]: !folded.value[key] }
}

function asTool(s: TraceStep): UiToolCall {
  return {
    id: s.key,
    name: s.name ?? 'tool',
    args: s.args ?? '',
    status: s.status ?? 'ok',
    output: s.output ?? '',
    seconds: s.seconds,
  }
}

const STATUS_TEXT = { running: '进行中', blocked: '被阻止', ok: '完成' } as const



function stepLabel(s: TraceStep): string {
  if (s.kind === 'tool') return s.name ?? 'tool'
  if (s.kind === 'reasoning') return '推理'
  return '回答'
}
</script>

<template>
  <div class="trace">
    <div class="head">
      <span class="title">轨迹</span>
      <span class="dim">{{ turns.length }} 轮</span>
      <span class="spacer" />
      <span class="dim">每一步都来自对话记录，可对历史会话回看</span>
    </div>

    <div class="list">
      <SubAgents />

      <section v-for="t in turns" :key="t.key" class="turn">
        <header class="turn-head" @click="toggle(t.key)">
          <span class="caret">{{ folded[t.key] ? '▸' : '▾' }}</span>
          <span class="idx">第 {{ t.index }} 轮</span>
          <span class="chip" :class="turnStatus(t)">{{ STATUS_TEXT[turnStatus(t)] }}</span>
          <span class="dim">{{ t.toolCount }} 步</span>
          <span class="spacer" />
          <span class="dim">{{ relativeTime(t.ts) }}</span>
        </header>

        <template v-if="!folded[t.key]">
          <p v-if="t.prompt" class="prompt">{{ t.prompt }}</p>
          <ol class="steps">
            <li v-for="s in t.steps" :key="s.key" class="step" :class="s.kind">
              <template v-if="s.kind === 'tool'">
                <ToolCallCard :tool="asTool(s)" />
              </template>
              <template v-else-if="s.kind === 'reasoning'">
                <details class="reason">
                  <summary>
                    <span class="badge">推理</span>
                    <span class="dim">{{ truncate((s.text ?? '').replace(/\s+/g, ' '), 80) }}</span>
                  </summary>
                  <pre class="reason-body">{{ s.text }}</pre>
                </details>
              </template>
              <template v-else>
                <div class="answer">
                  <span class="badge answer-badge">{{ stepLabel(s) }}</span>
                  <div class="md" v-html="renderMarkdown(s.text ?? '')" />
                </div>
              </template>
            </li>
          </ol>
          <p v-if="!t.steps.length" class="dim empty-turn">这一轮没有工具调用</p>
        </template>
      </section>
      <p v-if="!turns.length" class="dim empty">这一会话还没有可展示的轨迹</p>
    </div>
  </div>
</template>

<style scoped>
.trace {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--cell-alias-line-soft);
  font-size: var(--cell-font-size-sm);
  color: var(--cell-alias-ink-dim);
}

.title {
  font-weight: 600;
  color: var(--cell-alias-ink);
}

.spacer {
  flex: 1;
}

.dim {
  color: var(--cell-alias-ink-faint);
  font-size: var(--cell-font-size-xs);
}

.list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  max-width: var(--cell-content-width);
  width: 100%;
  margin: 0 auto;
  padding: 12px 18px 30px;
}

.turn {
  border: 1px solid var(--cell-alias-line-soft);
  border-radius: var(--cell-radius-md);
  background: var(--cell-alias-bg-raised);
  margin-bottom: 10px;
  overflow: hidden;
}

.turn-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: var(--cell-font-size-sm);
  border-bottom: 1px solid var(--cell-alias-line-soft);
}

.turn-head:hover {
  background: var(--cell-alias-bg-hover);
}

.caret {
  width: 10px;
  color: var(--cell-alias-ink-faint);
}

.idx {
  font-weight: 600;
}

.chip {
  font-size: var(--cell-font-size-xs);
  border-radius: var(--cell-radius-pill);
  padding: 0 8px;
  border: 1px solid var(--cell-alias-line);
  color: var(--cell-alias-ink-dim);
}

.chip.ok {
  border-color: var(--cell-alias-ok);
  color: var(--cell-alias-ok);
}

.chip.running {
  border-color: var(--cell-alias-accent);
  color: var(--cell-alias-accent);
}

.chip.blocked {
  border-color: var(--cell-alias-bad);
  color: var(--cell-alias-bad);
}

.prompt {
  margin: 10px 12px 4px;
  padding-left: 10px;
  border-left: 2px solid var(--cell-alias-accent-line);
  color: var(--cell-alias-ink);
  font-size: var(--cell-font-size-sm);
  white-space: pre-wrap;
  word-break: break-word;
}

.steps {
  list-style: none;
  margin: 0;
  padding: 6px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.step {
  min-width: 0;
}

.badge {
  display: inline-block;
  font-size: var(--cell-font-size-xs);
  border-radius: var(--cell-radius-xs);
  border: 1px solid var(--cell-alias-line);
  color: var(--cell-alias-ink-faint);
  padding: 0 6px;
  margin-right: 6px;
}

.reason summary {
  cursor: pointer;
  color: var(--cell-alias-ink-dim);
  font-size: var(--cell-font-size-sm);
}

.reason-body {
  margin: 6px 0 0;
  padding: 8px 10px;
  background: var(--cell-alias-bg-sunken);
  border-radius: var(--cell-radius-sm);
  color: var(--cell-alias-ink-dim);
  font-size: var(--cell-font-size-sm);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 260px;
  overflow: auto;
}

.answer {
  font-size: var(--cell-font-size-sm);
}

.answer-badge {
  margin-bottom: 4px;
}

.md :deep(p) {
  margin: 0.3em 0;
}



.job:hover {
  border-color: var(--cell-alias-accent-line);
}






.empty,
.empty-turn {
  text-align: center;
  padding: 18px 0;
}
</style>
