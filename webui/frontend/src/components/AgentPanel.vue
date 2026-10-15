<script setup lang="ts">
// Agent capability panel.
//
// Switches are backed by PATCH /v1/config; inventory by GET /v1/skills; spend
// by GET /v1/usages. Teamwork and compaction are fully live now
// (docs/RESTful.md §3.9): the read endpoints, the whole control side
// (create / edit / remove job, run / resume / stop, append / remove worker)
// and the manual compact trigger. The control buttons below mirror the
// kernel's real status machine — pending | running | waiting(stopped) |
// completed | failed — and its real guards: run refuses a job with no child
// agents, stop is cooperative (the runner pauses at a round/stage boundary,
// leaving the job `waiting` for a later resume), and a running job cannot be
// edited, appended to or removed.
import { computed, onMounted, ref } from 'vue'
import { api } from '../lib/api'
import { errorMessage } from '../lib/bridge'
import { summarizeCapabilities, toRows, type Skill } from '../lib/capabilities'
import type { SkillDetail, TeamworkAction, TeamworkJob } from '../lib/api'
import { refreshConfig, store, toast } from '../store'

const skills = ref<Skill[]>([])
const busy = ref(false)

// Skills: the kernel scans .cell/skills/ on every call (no install API), so
// "management" here is exactly what the kernel really offers — inventory,
// body read, and the /skill load twin.
const skillsLoading = ref(false)
const skillBusy = ref(false)
const openSkill = ref<SkillDetail | null>(null)

// Teamwork jobs + control actions, backed by the kernel endpoints in
// docs/RESTful.md §3.9.
const teamworks = ref<TeamworkJob[]>([])
const twLoading = ref(false)
const twBusy = ref(false)
/** Shared text box: the task for a new job, or the task of an appended child. */
const newTask = ref('')
const compacting = ref(false)
const compactStatus = ref('')

const summary = computed(() =>
  summarizeCapabilities({
    config: store.config,
    skills: { skills: skills.value },
    usage: (store.usage ?? undefined) as never,
  }),
)

const rows = computed(() => toRows(summary.value))

onMounted(async () => {
  await loadSkills()
  await loadTeamworks()
})

async function loadSkills(): Promise<void> {
  skillsLoading.value = true
  try {
    skills.value = (await api.skills()).skills ?? []
  } catch {
    skills.value = []
  } finally {
    skillsLoading.value = false
  }
}

/** Toggle the body viewer for one skill (the content endpoint, front matter
 *  already stripped by the kernel). */
async function viewSkill(name: string): Promise<void> {
  if (openSkill.value?.name === name) {
    openSkill.value = null
    return
  }
  try {
    openSkill.value = await api.skillContent(name)
  } catch (e) {
    openSkill.value = null
    toast('bad', errorMessage(e))
  }
}

/** Load a skill into the active session — the panel twin of `/skill NAME`. */
async function loadSkill(name: string): Promise<void> {
  const sid = store.config?.session_id
  if (!sid) {
    toast('bad', '当前没有活动会话')
    return
  }
  skillBusy.value = true
  try {
    const r = await api.loadSkill(sid, name)
    toast('ok', `已加载技能 ${r.name}（${r.chars} 字符）`)
  } catch (e) {
    const code = (e as { code?: string })?.code
    if (code === 'busy') toast('bad', '会话正忙，等当前回合结束后再加载')
    else toast('bad', errorMessage(e))
  } finally {
    skillBusy.value = false
  }
}

async function loadTeamworks(): Promise<void> {
  twLoading.value = true
  try {
    const list = await api.getTeamworks()
    teamworks.value = list.jobs ?? []
  } catch {
    teamworks.value = []
  } finally {
    twLoading.value = false
  }
}

async function runCompact(): Promise<void> {
  const sid = store.config?.session_id
  if (!sid) {
    toast('bad', '当前没有活动会话')
    return
  }
  compacting.value = true
  compactStatus.value = ''
  try {
    const r = await api.compactSession(sid)
    compactStatus.value = r.status
    toast(r.ok ? 'ok' : 'bad', r.ok ? '压缩完成' : '压缩未执行')
    await loadTeamworks()
  } catch (e) {
    const code = (e as { code?: string })?.code
    if (code === 'busy') toast('bad', '会话正忙，等当前回合结束后再压缩')
    else toast('bad', errorMessage(e))
  } finally {
    compacting.value = false
  }
}

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

// ---- teamwork control -------------------------------------------------------
// Every action funnels through one helper so the busy flag, the toast and the
// post-action refresh stay consistent. Returns whether it succeeded, so the
// callers that consume `newTask` only clear the box on success.
async function twAction(label: string, fn: () => Promise<TeamworkAction>): Promise<boolean> {
  twBusy.value = true
  try {
    const r = await fn()
    toast('ok', r.message ? `${label}：${r.message}` : label)
    await loadTeamworks()
    return true
  } catch (e) {
    toast('bad', errorMessage(e))
    return false
  } finally {
    twBusy.value = false
  }
}

async function createJob(): Promise<void> {
  const sid = store.config?.session_id
  const works = newTask.value.trim()
  if (!sid) {
    toast('bad', '当前没有活动会话')
    return
  }
  if (!works) {
    toast('bad', '先填写子代理任务描述')
    return
  }
  const ok = await twAction('已创建协作任务', () =>
    api.createTeamworkJob(sid, { 'work-type': 'serial', list: [{ works }] }),
  )
  if (ok) newTask.value = ''
}

function runJob(j: TeamworkJob): void {
  void twAction('已启动', () => api.runTeamworkJob(j.session, j.id))
}

function resumeJob(j: TeamworkJob): void {
  void twAction('已继续', () => api.resumeTeamworkJob(j.session, j.id))
}

function stopJob(j: TeamworkJob): void {
  void twAction('已请求停止（在下一个回合/阶段边界生效）', () => api.stopTeamworkJob(j.session, j.id))
}

function deleteJob(j: TeamworkJob): void {
  void twAction('已删除', () => api.deleteTeamworkJob(j.session, j.id))
}

async function appendWorker(j: TeamworkJob): Promise<void> {
  const works = newTask.value.trim()
  if (!works) {
    toast('bad', '先在上方填写子代理任务描述')
    return
  }
  const ok = await twAction('已追加子代理', () => api.appendTeamworkWorker(j.session, j.id, { works }))
  if (ok) newTask.value = ''
}

function removeWorker(j: TeamworkJob, name: string): void {
  void twAction('已移除子代理', () => api.removeTeamworkWorker(j.session, j.id, name))
}
</script>

<template>
  <section class="agent">
    <p v-for="d in summary.degraded" :key="d" class="warn">{{ d }}</p>

    <label>能力概览</label>
    <dl class="rows">
      <div v-for="r in rows" :key="r.label" class="row">
        <dt :title="r.hint">{{ r.label }}</dt>
        <dd>{{ r.value }}</dd>
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

    <label>协作任务</label>
    <div class="row btns">
      <input v-model="newTask" class="task" placeholder="子代理任务描述…" :disabled="busy || twBusy" />
      <button class="seg" :disabled="busy || twBusy" @click="createJob">新建</button>
      <button class="seg" :disabled="busy || twLoading" @click="loadTeamworks">刷新</button>
      <span v-if="twLoading" class="note">加载中…</span>
    </div>
    <ul v-if="teamworks.length" class="jobs">
      <li v-for="j in teamworks" :key="j.id">
        <div class="jobHead">
          <strong>{{ j.id }}</strong>
          <span class="muted">{{ j.session }} · {{ j.status }} · {{ j.work_type }}</span>
          <span v-if="j.is_workflow" class="muted"> · {{ j.workflow_name }}（{{ j.stages.length }} 阶段）</span>
          <span class="muted"> · {{ j.workers.length }} 子代理</span>
        </div>
        <div class="row btns jobActions">
          <button
            v-if="j.status === 'pending' || j.status === 'failed'"
            class="seg"
            :disabled="twBusy"
            @click="runJob(j)"
          >
            {{ j.status === 'failed' ? '重试' : '运行' }}
          </button>
          <button v-else-if="j.status === 'waiting'" class="seg" :disabled="twBusy" @click="resumeJob(j)">
            继续
          </button>
          <button v-if="j.status === 'running'" class="seg" :disabled="twBusy" @click="stopJob(j)">停止</button>
          <button
            v-if="j.status !== 'running' && j.status !== 'completed'"
            class="seg"
            :disabled="twBusy"
            @click="appendWorker(j)"
          >
            加子代理
          </button>
          <button
            v-if="j.status !== 'running' && j.status !== 'completed'"
            class="seg"
            :disabled="twBusy"
            @click="deleteJob(j)"
          >
            删除
          </button>
        </div>
        <ul v-if="j.workers.length" class="workers">
          <li v-for="w in j.workers" :key="w.name">
            <span class="muted">{{ w.name }} · {{ w.status }}</span>
            <button
              v-if="j.status !== 'running' && j.status !== 'completed'"
              class="seg mini"
              :disabled="twBusy"
              @click="removeWorker(j, w.name)"
            >
              移除
            </button>
          </li>
        </ul>
      </li>
    </ul>
    <p v-else class="note">暂无协作任务</p>

    <label>上下文压缩</label>
    <div class="row btns">
      <button class="seg" :disabled="busy || compacting" @click="runCompact">手动压缩当前会话</button>
    </div>
    <p v-if="compactStatus" class="note">{{ compactStatus }}</p>

    <label>技能（{{ summary.skills.length }}）</label>
    <div class="row btns">
      <button class="seg" :disabled="busy || skillsLoading" @click="loadSkills">刷新</button>
      <span v-if="skillsLoading" class="note">加载中…</span>
    </div>
    <ul v-if="summary.skills.length" class="skills">
      <li v-for="s in summary.skills" :key="s.name">
        <div class="skillHead">
          <button class="link" :title="openSkill?.name === s.name ? '收起' : '查看内容'" @click="viewSkill(s.name)">
            {{ s.name }}
          </button>
          <button class="seg mini" :disabled="skillBusy" @click="loadSkill(s.name)">加载到会话</button>
        </div>
        <span class="skillDesc">{{ s.description || '（无描述）' }}</span>
        <span class="muted skillFile">{{ s.file }}</span>
      </li>
    </ul>
    <p v-else class="note">.cell/skills/ 下暂无技能（放入带 front matter 的 .md 即被扫描）</p>
    <div v-if="openSkill" class="skillViewer">
      <div class="skillViewerHead">
        <strong>{{ openSkill.name }}</strong>
        <span class="muted">{{ openSkill.file }}</span>
      </div>
      <pre class="skillBody">{{ openSkill.content }}</pre>
    </div>
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

.jobs {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 160px;
  overflow-y: auto;
}

.jobs li {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  color: var(--ink-dim);
  padding: 4px 0;
  border-bottom: 1px dashed var(--line);
}

.jobs li:last-child {
  border-bottom: none;
}

.jobHead {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.jobs strong {
  color: var(--ink);
}

.jobActions {
  gap: 4px;
}

.task {
  flex: 1 1 140px;
  min-width: 0;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--ink);
  border-radius: 8px;
  padding: 4px 8px;
  font: inherit;
  font-size: 12px;
}

.task::placeholder {
  color: var(--ink-faint);
}

.workers {
  margin: 0;
  padding: 0 0 0 10px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.workers li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 0;
  border-bottom: none;
  font-size: 11.5px;
}

.seg.mini {
  padding: 1px 7px;
  font-size: 11px;
  border-radius: 6px;
}

.muted {
  color: var(--ink-faint);
}

.skills li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--ink-dim);
}

.skillHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.link {
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ink);
  cursor: pointer;
  text-align: left;
  text-decoration: underline dotted var(--line);
}

.skillDesc {
  color: var(--ink-dim);
}

.skillFile {
  font-size: 11px;
}

/* the viewer names the skill it belongs to: the body alone would be detached
   from its row once the list scrolls */
.skillViewer {
  margin-top: 4px;
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
}

.skillViewerHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--line);
  font-size: 11.5px;
  color: var(--ink);
}

.skillBody {
  margin: 0;
  padding: 8px;
  max-height: 220px;
  overflow: auto;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--ink-dim);
  white-space: pre-wrap;
  word-break: break-word;
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
