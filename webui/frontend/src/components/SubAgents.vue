<script setup lang="ts">
// The sub-agent panel: launch a team, watch it, steer it.
//
// Everything here sits on endpoints that have existed for a while — what was
// missing was the shell's half. Two rules shape the UI:
//   * `run`/`resume` are background on the kernel side, so this returns as soon
//     as the job is accepted and the status is polled while it runs (notices
//     carry the progress messages, the store carries the state);
//   * a control is shown only when the job's state allows it, because a button
//     that answers 400 is worse than no button.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  addJobWorker,
  controlJob,
  createTeamwork,
  loadWorkerReport,
  refreshJobs,
  removeJobWorker,
  store,
} from '../store'
import { jobControls, jobStatusLabel, jobStatusTone, progressLine } from '../lib/teamwork'
import { formatCompact } from '../lib/format'

const POLL_MS = 2000

const open = ref(false)
const formOpen = ref(false)
const tasks = ref('')
const mode = ref<'serial' | 'parallel'>('parallel')
const busy = ref(false)
const workerDraft = ref('')

const maxChildren = computed(() => store.config?.teamwork_max_children ?? 8)
const taskCount = computed(() => tasks.value.split('\n').filter((t) => t.trim()).length)
const running = computed(() => store.jobs.some((j) => j.status === 'running'))

async function submit(runNow: boolean): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    if (await createTeamwork(tasks.value.split('\n'), mode.value, runNow)) {
      tasks.value = ''
      formOpen.value = false
    }
  } finally {
    busy.value = false
  }
}

function onAddWorker(jobId: string): void {
  const works = workerDraft.value.trim()
  if (!works) return
  workerDraft.value = ''
  void addJobWorker(jobId, works)
}

// Poll only while something is actually running: a panel nobody is watching
// should not be a stream of requests, and a finished job's status does not move.
let timer = 0
function syncPolling(): void {
  if (running.value && !timer) timer = window.setInterval(() => void refreshJobs(), POLL_MS)
  else if (!running.value && timer) {
    window.clearInterval(timer)
    timer = 0
  }
}
watch(running, syncPolling)
onMounted(() => {
  if (store.jobs.length) void refreshJobs()
  syncPolling()
})
onUnmounted(() => {
  if (timer) window.clearInterval(timer)
})
</script>

<template>
  <section class="agents">
    <header class="turn-head" @click="open = !open">
      <span class="caret">{{ open ? '▾' : '▸' }}</span>
      <span class="idx">子智能体</span>
      <span v-if="store.jobs.length" class="chip">{{ store.jobs.length }} 个任务</span>
      <span class="spacer" />
      <button
        class="mini"
        type="button"
        :title="formOpen ? '收起' : '新建一个子智能体任务'"
        @click.stop="formOpen = !formOpen"
      >
        {{ formOpen ? '收起' : '＋ 新建' }}
      </button>
    </header>

    <div v-if="open" class="body">
      <!-- the launcher: one task per line, one child agent per line -->
      <div v-if="formOpen" class="launcher">
        <textarea
          v-model="tasks"
          class="tasks"
          rows="4"
          :placeholder="`每行一条任务，每行一名子智能体。&#10;例：&#10;审一遍 SSE 事件与前端消费点&#10;对照 RESTful.md 找缺的路由`"
        />
        <div class="lrow">
          <select v-model="mode" class="mode">
            <option value="parallel">并行</option>
            <option value="serial">串行（后者接着前者的结果）</option>
          </select>
          <span class="dim">{{ taskCount }} / {{ maxChildren }} 名</span>
          <span class="spacer" />
          <button class="mini" type="button" :disabled="busy || !taskCount" @click="submit(false)">仅创建</button>
          <button class="mini primary" type="button" :disabled="busy || !taskCount" @click="submit(true)">
            创建并运行
          </button>
        </div>
        <p class="hint">
          子智能体在后台跑（一次 LLM 回合接一轮），进度以通知送达；停止是协作式的，会在下一个边界暂停。
        </p>
      </div>

      <p v-if="!store.jobs.length && !formOpen" class="empty">
        这一会话还没有协作任务。写几行任务，每行交给一名子智能体。
      </p>

      <div v-for="j in store.jobs" :key="j.id" class="job" :class="jobStatusTone(j.status)">
        <div class="jhead">
          <span class="jid">{{ j.id }}</span>
          <span class="status">{{ jobStatusLabel(j.status) }}</span>
          <span v-if="progressLine(j)" class="dim">{{ progressLine(j) }}</span>
          <span class="dim">{{ j.created }}</span>
        </div>
        <div class="jrow">
          <button class="mini" type="button" @click="loadWorkerReport(j.id, true)">报告</button>
          <template v-if="jobControls(j).run">
            <button class="mini primary" type="button" @click="controlJob(j.id, 'run')">运行</button>
          </template>
          <template v-if="jobControls(j).stop">
            <button class="mini" type="button" @click="controlJob(j.id, 'stop')">停止</button>
          </template>
          <template v-if="jobControls(j).resume">
            <button class="mini primary" type="button" @click="controlJob(j.id, 'resume')">继续</button>
          </template>
          <template v-if="jobControls(j).remove">
            <button class="mini danger" type="button" @click="controlJob(j.id, 'remove')">删除</button>
          </template>
          <span v-if="j.error" class="err" :title="j.error">出错</span>
        </div>
        <!-- workers can only be added or removed while the job is still pending -->
        <div v-if="j.status === 'pending' && !j.is_workflow" class="jrow add">
          <input
            v-model="workerDraft"
            class="wdraft"
            placeholder="再加一名子智能体要做什么"
            @keydown.enter.prevent="onAddWorker(j.id)"
          />
          <button class="mini" type="button" @click="onAddWorker(j.id)">加入</button>
        </div>
        <div v-for="w in j.workers ?? []" :key="w.name" class="wrow">
          <span class="wname">{{ w.name }}</span>
          <span class="dim">{{ w.status }}</span>
          <span class="dim">{{ w.rounds }} 轮 · {{ w.tool_calls }} 步</span>
          <span v-if="w.model" class="dim">{{ w.model }}</span>
          <button
            v-if="j.status === 'pending'"
            class="mini"
            type="button"
            title="移除这名子智能体"
            @click="removeJobWorker(j.id, w.name)"
          >
            ×
          </button>
        </div>
      </div>

      <div v-if="store.workerReport" class="report">
        <p class="dim">报告：{{ store.workerReport.job }}</p>
        <div v-for="w in store.workerReport.workers" :key="w.name" class="worker">
          <span class="w-name">{{ w.name }}</span>
          <span class="dim">
            {{ w.status }} · {{ w.rounds }} 轮 · {{ w.tool_calls }} 步
            <template v-if="w.total_tokens"> · {{ formatCompact(w.total_tokens) }} tok</template>
            <template v-if="w.reviews_approved || w.reviews_denied">
              · 审阅 {{ w.reviews_approved ?? 0 }}/{{ w.reviews_denied ?? 0 }}
            </template>
          </span>
          <p v-if="w.works" class="w-works">{{ w.works }}</p>
          <p v-if="w.summary" class="w-summary">{{ w.summary }}</p>
          <p v-if="w.has_transcript && !w.messages" class="dim">
            transcript 已落盘（{{ formatCompact(w.transcript_bytes ?? 0) }} 字节）
          </p>
        </div>
      </div>
      <p v-if="store.workerReportError" class="dim">报告读取失败：{{ store.workerReportError }}</p>
    </div>
  </section>
</template>

<style scoped>
.agents {
  border-bottom: 1px solid var(--cell-alias-line-soft);
}

.body {
  padding: 8px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.launcher {
  border: 1px solid var(--cell-alias-line-soft);
  border-radius: var(--cell-radius-sm);
  padding: 8px;
  background: var(--cell-alias-bg-base);
}

.tasks {
  width: 100%;
  border: 0;
  outline: 0;
  resize: vertical;
  background: transparent;
  color: var(--cell-alias-ink);
  font-size: var(--cell-font-size-sm);
  line-height: 1.6;
}

.lrow {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

.mode {
  border: 1px solid var(--cell-alias-line);
  border-radius: var(--cell-radius-xs);
  background: var(--cell-alias-bg-raised);
  color: var(--cell-alias-ink);
  font-size: var(--cell-font-size-xs);
  padding: 2px 4px;
}

.spacer {
  flex: 1;
}

.hint {
  margin: 6px 0 0;
  color: var(--cell-alias-ink-faint);
  font-size: var(--cell-font-size-xs);
  line-height: 1.6;
}

.job {
  border: 1px solid var(--cell-alias-line-soft);
  border-left-width: 3px;
  border-radius: var(--cell-radius-sm);
  padding: 7px 9px;
  background: var(--cell-alias-bg-base);
}

.job.run {
  border-left-color: var(--cell-alias-accent);
}

.job.wait {
  border-left-color: var(--cell-alias-warn);
}

.job.done {
  border-left-color: var(--cell-alias-good);
}

.job.bad {
  border-left-color: var(--cell-alias-bad);
}

.jhead,
.jrow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: var(--cell-font-size-xs);
}

.jrow {
  margin-top: 5px;
}

.jid {
  font-family: var(--cell-mono);
  color: var(--cell-alias-ink);
}

.status {
  color: var(--cell-alias-ink-dim);
}

.err {
  color: var(--cell-alias-bad);
}

.mini {
  border: 1px solid var(--cell-alias-line);
  border-radius: var(--cell-radius-xs);
  background: var(--cell-alias-bg-raised);
  color: var(--cell-alias-ink-dim);
  font-size: var(--cell-font-size-xs);
  padding: 1px 8px;
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

.wdraft {
  flex: 1;
  min-width: 120px;
  border: 1px solid var(--cell-alias-line);
  border-radius: var(--cell-radius-xs);
  background: var(--cell-alias-bg-raised);
  color: var(--cell-alias-ink);
  font-size: var(--cell-font-size-xs);
  padding: 2px 6px;
}

.wrow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: var(--cell-font-size-xs);
  color: var(--cell-alias-ink-dim);
}

.wname,
.w-name {
  font-family: var(--cell-mono);
}

.report {
  border-left: 2px solid var(--cell-alias-line);
  padding-left: 10px;
}

.worker {
  margin: 6px 0;
}

.w-works,
.w-summary {
  margin: 2px 0;
  font-size: var(--cell-font-size-xs);
  color: var(--cell-alias-ink-dim);
  white-space: pre-wrap;
  word-break: break-word;
}

.empty,
.dim {
  font-size: var(--cell-font-size-xs);
}
</style>