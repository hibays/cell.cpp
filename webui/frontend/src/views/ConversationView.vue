<script setup lang="ts">
// Conversation view: transcript, live stream, approvals, composer.
//
// Extracted from the old single-file shell so the frame (AppShell) can switch
// between this and the trace view without either owning the other's chrome.
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { interrupt, newSession, reloadMessages, resume, selectSession, send, store, toast } from '../store'
import MessageItem from '../components/MessageItem.vue'
import Composer from '../components/Composer.vue'
import ApprovalCard from '../components/ApprovalCard.vue'
import { liveText } from '../lib/liveTurn'
import { createScrollAnchor } from '../lib/scrollAnchor'
import { computeWindow } from '../lib/window'
import type { UiMessage } from '../lib/transcript'

const emit = defineEmits<{ export: [] }>()

const scroller = ref<HTMLDivElement | null>(null)

// --- scroll ownership ---------------------------------------------------------
// The view follows new output only while the reader is at the tail. Our own
// pinning fires the same scroll event a gesture does, so ownership is explicit
// rather than inferred from the event.
const anchor = createScrollAnchor()
// only the affordance needs to be reactive; `stick` is consulted imperatively
const showJump = ref(anchor.showJump)

function syncAnchor(): void {
  showJump.value = anchor.showJump
}

// --- windowing ----------------------------------------------------------------
// A long session used to mount every message. Only the rows near the viewport
// are mounted now; spacers stand in for the rest so the scrollbar stays honest.
const scrollTop = ref(0)
const viewport = ref(0)
const heights = ref<number[]>([])

const win = computed(() =>
  computeWindow({
    count: store.messages.length,
    heights: heights.value,
    scrollTop: scrollTop.value,
    viewport: viewport.value,
    overscan: 3,
  }),
)

const visibleMessages = computed(() => store.messages.slice(win.value.start, win.value.end))

let observer: ResizeObserver | null = null

/** Record the heights of what is currently mounted; unmounted rows keep their estimate. */
function measure(): void {
  const root = scroller.value
  if (!root || !observer) return
  observer.disconnect()
  const next = [...heights.value]
  for (const el of root.querySelectorAll<HTMLElement>('[data-mk]')) {
    observer.observe(el)
    const idx = Number(el.dataset.mk)
    const h = el.getBoundingClientRect().height
    if (Number.isInteger(idx) && idx >= 0 && h > 0) next[idx] = h
  }
  heights.value = next
}

const chips = ['介绍一下这个仓库', '解释 cell.cpp 的架构', '帮我写一个 CMake 选项']

// The live turn is a message like any other: same renderer, same tool cards,
// same block cache for markdown — the difference is that it comes from the
// kernel's semantic events (lib/liveTurn) instead of the transcript, so
// reasoning and tool calls appear while the turn runs.
const streamMessage = computed<UiMessage>(() => {
  const live = store.live
  if (!live) return { key: 'streaming', role: 'assistant', text: '' }
  return {
    key: 'streaming',
    role: 'assistant',
    text: liveText(live),
    reasoning: live.reasoning || undefined,
    tools: live.tools.length ? live.tools : undefined,
  }
})

function readScroller(): void {
  const el = scroller.value
  if (!el) return
  scrollTop.value = el.scrollTop
  viewport.value = el.clientHeight
}

function onScroll(): void {
  const el = scroller.value
  if (!el) return
  readScroller()
  anchor.onScroll(
    { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight },
    'user',
  )
  syncAnchor()
}

async function scrollToBottom(): Promise<void> {
  await nextTick()
  const el = scroller.value
  if (!el) return
  el.scrollTop = el.scrollHeight
  // declare it: our pin must not read as the reader leaving the tail
  anchor.onScroll(
    { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight },
    'programmatic',
  )
  readScroller()
  syncAnchor()
}

function jumpToLatest(): void {
  anchor.reset()
  syncAnchor()
  void scrollToBottom()
}

/** Retry a failed transcript load — the error card's only button. */
async function retryMessages(): Promise<void> {
  await reloadMessages()
}

watch(
  () => [streamMessage.value.text.length, streamMessage.value.tools?.length ?? 0, store.messages.length] as const,
  async () => {
    if (anchor.stick) await scrollToBottom()
    else {
      anchor.onContentGrown({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 })
      syncAnchor()
    }
    await nextTick()
    measure()
  },
)

// a new session means a new list: forget both the window and the ownership
watch(
  () => store.currentSession,
  () => {
    heights.value = []
    anchor.reset()
    syncAnchor()
    void scrollToBottom()
  },
)

onMounted(async () => {
  observer = new ResizeObserver((entries) => {
    const next = [...heights.value]
    let changed = false
    for (const entry of entries) {
      const el = entry.target as HTMLElement
      const idx = Number(el.dataset.mk)
      const h = el.getBoundingClientRect().height
      if (Number.isInteger(idx) && idx >= 0 && h > 0 && next[idx] !== h) {
        next[idx] = h
        changed = true
      }
    }
    if (changed) heights.value = next
  })

  readScroller()
  if (store.currentSession) await selectSession(store.currentSession)
  else {
    const id = await newSession()
    if (id) await selectSession(id)
  }
  await scrollToBottom()
  measure()
})

onUnmounted(() => observer?.disconnect())
</script>

<template>
  <div class="conversation">
    <div ref="scroller" class="scroll" @scroll="onScroll">
      <div class="column">
        <!-- spacers keep the scrollbar honest for the rows that are not mounted -->
        <div :style="{ height: `${win.padTop}px` }" />
        <MessageItem
          v-for="(m, i) in visibleMessages"
          :key="m.key"
          :message="m"
          :data-mk="win.start + i"
          @copy="toast('ok', $event)"
        />
        <div :style="{ height: `${win.padBottom}px` }" />
        <MessageItem
          v-if="store.streaming && (streamMessage.text || streamMessage.tools?.length)"
          :message="streamMessage"
          streaming
          @copy="toast('ok', $event)"
        />
        <ApprovalCard v-for="a in store.approvals" :key="a.request_id" :approval="a" />
        <!-- a failed load must not look like a new session: say what happened,
             and offer the one action that can fix it -->
        <div v-if="store.messagesError" class="load-error" role="alert">
          <p class="why">会话记录加载失败</p>
          <p class="detail">{{ store.messagesError }}</p>
          <button class="retry" type="button" @click="retryMessages()">重试</button>
        </div>
        <div v-if="!store.messages.length && !store.streaming && !store.messagesError" class="welcome">
          <h2>开始吧</h2>
          <p>选择一个起点，或直接输入：</p>
          <div class="chips">
            <button v-for="c in chips" :key="c" @click="send(c)">{{ c }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ownership is the reader's: offer a way back instead of yanking the view -->
    <button v-if="showJump" class="jump" type="button" @click="jumpToLatest()">
      ↓ 回到最新
    </button>

    <div class="composer-wrap">
      <Composer @export="emit('export')" />
      <div class="quick">
        <button v-if="store.lastInterrupted && !store.streaming" class="q" @click="resume()">
          ↻ 继续上次中断
        </button>
        <span class="spacer" />
        <button v-if="store.streaming" class="q danger" @click="interrupt()">中断 (Esc)</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.conversation {
  position: relative; /* anchors the jump-to-latest button */
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.jump {
  position: absolute;
  right: 28px;
  bottom: 116px;
  z-index: 5;
  border: 1px solid var(--cell-alias-line);
  border-radius: var(--cell-radius-pill);
  background: var(--cell-alias-bg-raised);
  color: var(--cell-alias-ink-dim);
  font: inherit;
  font-size: var(--cell-font-size-sm);
  padding: 5px 14px;
  box-shadow: var(--cell-alias-shadow);
}

.jump:hover {
  color: var(--cell-alias-ink);
  border-color: var(--cell-alias-ink-faint);
}

.scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.column {
  max-width: var(--cell-content-width);
  margin: 0 auto;
  padding: 20px 22px 26px;
}

.welcome {
  text-align: center;
  padding: 8vh 0;
  color: var(--cell-alias-ink-dim);
  animation: cell-fade-in 0.4s ease both;
}

.load-error {
  margin: 8vh auto 0;
  max-width: 42em;
  text-align: center;
  border: 1px solid var(--cell-alias-bad-soft);
  border-radius: var(--cell-radius-md);
  background: var(--cell-alias-bg-raised);
  padding: 22px 26px;
}

.load-error .why {
  margin: 0 0 6px;
  color: var(--cell-alias-bad);
  font-weight: 600;
}

.load-error .detail {
  margin: 0 0 14px;
  color: var(--cell-alias-ink-dim);
  font-size: var(--cell-font-size-sm);
}

.load-error .retry {
  border: 1px solid var(--cell-alias-line);
  border-radius: var(--cell-radius-pill);
  background: none;
  color: var(--cell-alias-ink);
  font: inherit;
  font-size: var(--cell-font-size-sm);
  padding: 4px 18px;
}

.load-error .retry:hover {
  border-color: var(--cell-alias-accent);
  color: var(--cell-alias-accent);
}

.welcome h2 {
  color: var(--cell-alias-ink);
  margin: 0 0 6px;
}

.chips {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
  margin-top: 14px;
}

.chips button {
  border: 1px solid var(--cell-alias-line);
  background: var(--cell-alias-bg-raised);
  border-radius: var(--cell-radius-pill);
  padding: 6px 14px;
  font-size: var(--cell-font-size-sm);
  color: var(--cell-alias-ink-dim);
}

.chips button:hover {
  border-color: var(--cell-alias-accent);
  color: var(--cell-alias-ink);
}

.composer-wrap {
  padding: 10px 22px 10px;
}

.quick {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: var(--cell-content-width);
  margin: 8px auto 0;
}

.q {
  border: 1px solid var(--cell-alias-line);
  background: var(--cell-alias-bg-raised);
  border-radius: var(--cell-radius-pill);
  padding: 3px 12px;
  font-size: var(--cell-font-size-xs);
  color: var(--cell-alias-ink-dim);
}

.q.danger {
  color: var(--cell-alias-bad);
  border-color: var(--cell-alias-bad-soft);
}

@media (max-width: 900px) {
  .column {
    padding: 14px 12px 10px;
  }
  .composer-wrap {
    padding: 8px 12px;
  }
}
</style>
