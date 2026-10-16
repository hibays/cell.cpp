<script setup lang="ts">
// The composer: the one control the user touches every turn.
//
// It owns four things the old one-line textarea did not:
//   * triggers — `/` for commands and `@` for mentions, resolved against the
//     working directory the kernel reports (lib/trigger.ts + lib/mentions.ts);
//   * attachments — path references the message carries, browsable through the
//     kernel's read-only file listing (no fake file dialog: the shell has no
//     native one, and inventing one would be a lie);
//   * selectors — permission fence, model and think level, each writing through
//     the config API the settings panel already uses;
//   * a one-turn queue — cell runs one turn at a time, so a message typed while
//     it works waits instead of being rejected with 409.
//
// While an approval is pending the composer steps aside: the turn is blocked on
// that decision, so typing into it would go nowhere.
import { computed, onMounted, ref, watch } from 'vue'
import MenuList, { type MenuItem } from './MenuList.vue'
import { api } from '../lib/api'
import {
  attach,
  clearAttachments,
  clearQueued,
  detach,
  interrupt,
  newSession,
  refreshFiles,
  setFence,
  setModel,
  setThink,
  store,
  submitOrQueue,
  toast,
} from '../store'
import { argCandidates, findCommand, matchCommands, type CommandDef } from '../lib/commands'
import { mentionCandidates } from '../lib/mentions'
import { PRESETS, fromKernelConfig } from '../lib/permissions'
import { replaceToken, tokenAt, type TriggerToken } from '../lib/trigger'
import { formatCompact } from '../lib/format'

const emit = defineEmits<{ export: [] }>()

const text = ref('')
const box = ref<HTMLTextAreaElement | null>(null)

type MenuMode = 'none' | 'command' | 'arg' | 'mention' | 'files' | 'model' | 'fence' | 'think'
const mode = ref<MenuMode>('none')
/** The trigger token a palette replaces (commands and mentions). */
const token = ref<TriggerToken | null>(null)
/** The command whose argument is being completed. */
const pendingCommand = ref<CommandDef | null>(null)
const menuItems = ref<MenuItem[]>([])

const FENCE_LABEL: Record<string, string> = {
  'read-only': '只读',
  'edit-only': '可编辑',
  'full-access': '完全权限',
}

const fenceLabel = computed(() => {
  const sel = fromKernelConfig({ sandbox_mode: store.config?.sandbox_mode })
  return FENCE_LABEL[sel.sandbox] ?? sel.sandbox
})

const modelLabel = computed(() => store.config?.current_model || '未选择模型')
const thinkLabel = computed(() => {
  const cfg = store.config
  if (!cfg) return '—'
  return cfg.think_levels[cfg.think_level] ?? String(cfg.think_level)
})

// ---- auto-grow ---------------------------------------------------------------
// Grow to a cap (the harness's 14 rows) and scroll beyond it, so the transcript
// keeps most of the window however long the prompt is.
const MAX_ROWS = 14
const LINE_HEIGHT = 21

function resize(): void {
  const el = box.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, LINE_HEIGHT * MAX_ROWS)}px`
}

watch(text, () => void resize())

// ---- menus -------------------------------------------------------------------
function openMenu(m: MenuMode, items: MenuItem[]): void {
  mode.value = m
  menuItems.value = items
  if (mode.value !== 'arg') pendingCommand.value = mode.value === 'command' ? null : pendingCommand.value
}

function closeMenu(): void {
  mode.value = 'none'
  pendingCommand.value = null
}

/** Recompute the caret palettes after every edit or cursor move. */
function syncTriggers(): void {
  if (mode.value === 'files' || mode.value === 'model' || mode.value === 'fence' || mode.value === 'think') return
  const el = box.value
  const pos = el?.selectionStart ?? text.value.length

  const cmd = tokenAt(text.value, pos, '/')
  if (cmd) {
    token.value = cmd
    openMenu(
      'command',
      matchCommands(cmd.query).map((c) => ({ key: `cmd:${c.name}`, label: c.name, hint: c.desc })),
    )
    return
  }
  if (mode.value === 'arg' && pendingCommand.value?.arg) {
    const spec = pendingCommand.value.arg
    const candidates = argCandidates(spec, {
      skills: store.skills.map((s) => s.name),
      levels: store.config?.think_levels ?? [],
      sandboxes: ['read-only', 'edit-only', 'full-access'],
    })
    openMenu(
      'arg',
      candidates.map((v) => ({ key: `arg:${v}`, label: v, hint: `${pendingCommand.value!.name} 的参数` })),
    )
    return
  }
  const men = tokenAt(text.value, pos, '@')
  if (men) {
    token.value = men
    openMenu(
      'mention',
      mentionCandidates(men.query, { files: store.files, sessions: store.sessions, skills: store.skills }).map((c) => ({
        key: `mention:${c.insert}`,
        label: c.label,
        hint: c.hint,
        meta: c.kind === 'file' ? '文件' : c.kind === 'session' ? '会话' : '技能',
      })),
    )
    return
  }
  closeMenu()
}

// ---- menu picks --------------------------------------------------------------
function applyToken(value: string, trailingSpace: boolean): number {
  const t = token.value
  if (!t) return text.value.length
  const r = replaceToken(text.value, t, value, { trailingSpace })
  text.value = r.text
  return r.caret
}

function onPick(key: string): void {
  if (key.startsWith('cmd:')) {
    const cmd = findCommand(key.slice(4))
    if (!cmd || !token.value) return closeMenu()
    if (cmd.arg) {
      const caret = applyToken(`${cmd.name} `, false)
      pendingCommand.value = cmd
      focusBox(caret)
      syncTriggers()
      return
    }
    applyToken('', false)
    closeMenu()
    void runCommand(cmd, '')
    return
  }
  if (key.startsWith('arg:')) {
    const cmd = pendingCommand.value
    const t = token.value
    if (!cmd || !t) return closeMenu()
    // the argument replaces everything from the command's `/` to the caret
    const r = replaceToken(text.value, { ...t, end: text.value.length }, `${cmd.name} ${key.slice(4)} `, {
      trailingSpace: false,
    })
    text.value = r.text
    closeMenu()
    void runCommand(cmd, key.slice(4))
    return
  }
  if (key.startsWith('mention:')) {
    const caret = applyToken(key.slice(8), true)
    closeMenu()
    focusBox(caret)
    return
  }
  if (key.startsWith('file:')) {
    attach(key.slice(5))
    closeMenu()
    return
  }
  if (key.startsWith('dir:')) {
    const dir = key.slice(4)
    void refreshFiles(dir).then(() => openFilePicker(dir))
    return
  }
  if (key === 'dir:up') {
    const parts = store.filePath.split('/').filter(Boolean)
    parts.pop()
    const up = parts.join('/')
    void refreshFiles(up).then(() => openFilePicker(up))
    return
  }
  if (key.startsWith('model:')) {
    void setModel(store.config?.current_provider ?? '', key.slice(6))
    closeMenu()
    return
  }
  if (key.startsWith('provider:')) {
    void setModel(key.slice(9))
    closeMenu()
    return
  }
  if (key.startsWith('fence:')) {
    const preset = key.slice(6) as 'safe' | 'standard' | 'auto'
    void setFence(PRESETS[preset].sandbox, PRESETS[preset].approval === 'never')
    closeMenu()
    return
  }
  if (key.startsWith('think:')) {
    void setThink(Number(key.slice(6)))
    closeMenu()
  }
}

/** Run a `/command`: kernel ones go over REST, shell ones are local UI actions. */
async function runCommand(cmd: CommandDef, arg: string): Promise<void> {
  const sid = store.currentSession
  try {
    switch (cmd.name) {
      case '/compact':
        if (!sid) return toast('warn', '还没有会话')
        await api.compactSession(sid)
        toast('ok', '上下文已压缩')
        return
      case '/skill':
        if (!sid) return toast('warn', '还没有会话')
        await api.loadSkill(sid, arg)
        toast('ok', `已加载技能 ${arg}`)
        return
      case '/think': {
        const idx = (store.config?.think_levels ?? []).indexOf(arg)
        if (idx < 0) return toast('warn', `未知的思考深度：${arg}`)
        await setThink(idx)
        return
      }
      case '/sandbox':
        if (!['read-only', 'edit-only', 'full-access'].includes(arg))
          return toast('warn', `未知的沙箱模式：${arg}`)
        await setFence(arg, false)
        return
      case '/tool': {
        const on = arg !== 'off'
        await api.patchConfig({ tools: on })
        if (store.config) store.config.tools = on
        toast('ok', `工具调用：${on ? '开启' : '关闭'}`)
        return
      }
      case '/usages': {
        const all = store.usage?.all
        toast(
          'info',
          all
            ? `安装合计 ${all.requests} 次请求 · ${formatCompact(all.inputTokens)}↑ ${formatCompact(all.outputTokens)}↓ tokens`
            : '用量统计尚不可用',
        )
        return
      }
      case '/new':
        await newSession()
        return
      case '/export':
        emit('export')
        return
      case '/help':
        toast('info', '/compact /skill /think /sandbox /tool · @ 引用文件或会话 · Enter 发送，Shift+Enter 换行')
        return
      default:
        toast('warn', `未知命令：${cmd.name}`)
    }
  } catch (e) {
    toast('bad', `${cmd.name} 失败：${String(e)}`)
  }
}

// ---- the pickers -------------------------------------------------------------
async function openFilePicker(at?: string): Promise<void> {
  if (at === undefined && !store.files.length) await refreshFiles()
  const items: MenuItem[] = [{ key: 'hdr', label: store.filePath || '工作目录', header: true }]
  if (store.filePath) items.push({ key: 'dir:up', label: '..', hint: '返回上一级' })
  for (const f of store.files)
    items.push({
      key: f.dir ? `dir:${f.path}` : `file:${f.path}`,
      label: f.name + (f.dir ? '/' : ''),
      hint: f.dir ? '目录' : f.size >= 0 ? `${formatCompact(f.size)} 字节` : '',
      meta: f.dir ? '' : '添加',
    })
  openMenu('files', items)
}

async function openModelMenu(): Promise<void> {
  const items: MenuItem[] = []
  const current = store.config?.current_provider ?? ''
  if (current) {
    let models: string[] = []
    try {
      models = (await api.providerModels(current)).models ?? []
    } catch {
      models = []
    }
    if (models.length) {
      items.push({ key: 'hdr:models', label: `${current} 的模型`, header: true })
      for (const m of models.slice(0, 24))
        items.push({ key: `model:${m}`, label: m, meta: m === store.config?.current_model ? '当前' : '' })
    } else {
      // unreachable provider: say so rather than showing an empty menu
      items.push({ key: 'hdr:note', label: '模型列表不可用（提供方不可达）', header: true })
    }
  }
  items.push({ key: 'hdr:providers', label: '提供方', header: true })
  for (const p of store.providers)
    items.push({
      key: `provider:${p.name}`,
      label: p.name,
      hint: p.base,
      meta: p.current ? '当前' : p.key_set ? '' : '缺密钥',
    })
  openMenu('model', items)
}

function openFenceMenu(): void {
  const sel = fromKernelConfig({ sandbox_mode: store.config?.sandbox_mode })
  openMenu(
    'fence',
    Object.entries(PRESETS).map(([id, p]) => ({
      key: `fence:${id}`,
      label: FENCE_LABEL[p.sandbox] ?? p.sandbox,
      hint: p.description,
      meta: p.sandbox === sel.sandbox ? '当前' : '',
    })),
  )
}

function openThinkMenu(): void {
  const levels = store.config?.think_levels ?? []
  openMenu(
    'think',
    levels.map((l, i) => ({ key: `think:${i}`, label: l, meta: i === store.config?.think_level ? '当前' : '' })),
  )
}

// ---- submit ------------------------------------------------------------------
function focusBox(pos?: number): void {
  void Promise.resolve().then(() => {
    const el = box.value
    if (!el) return
    el.focus()
    if (pos !== undefined) el.setSelectionRange(pos, pos)
    syncTriggers()
  })
}

function onSubmit(): void {
  const body = text.value.trim()
  if (!body || store.approvals.length) return
  // attachments are path references the agent can read: say that in the message
  // instead of pretending the file was uploaded somewhere
  const refs = store.attachments.length
    ? `\n\n参考文件：\n${store.attachments.map((p) => `- ${p}`).join('\n')}`
    : ''
  const queued = submitOrQueue(body + refs)
  text.value = ''
  clearAttachments()
  if (queued) toast('info', '已排队，本轮结束后自动发送')
  focusBox(0)
}

function onKeydown(e: KeyboardEvent): void {
  if (mode.value !== 'none') return // the palette handles keys while it is open
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    onSubmit()
  }
}

function onDrop(e: DragEvent): void {
  // a dropped OS file has no path in the browser, so only text can be attached;
  // dropping a snippet inserts it, dropping something path-shaped attaches it
  const dropped = e.dataTransfer?.getData('text/plain') ?? ''
  if (!dropped) return
  const el = box.value
  const pos = el?.selectionStart ?? text.value.length
  text.value = text.value.slice(0, pos) + dropped + text.value.slice(pos)
  focusBox(pos + dropped.length)
  if (/[\\/]/.test(dropped) && !/\s/.test(dropped.trim())) attach(dropped.trim())
}

onMounted(() => {
  void resize()
  void refreshFiles()
})
</script>

<template>
  <div class="composer" :class="{ waiting: store.approvals.length > 0 }">
    <div v-if="store.approvals.length" class="veto">
      有一个待审批的工具调用——在下方卡片里选择，或按 <kbd>Y</kbd> 允许 / <kbd>N</kbd> 拒绝
    </div>

    <div v-if="store.attachments.length" class="rail">
      <span v-for="p in store.attachments" :key="p" class="chip" :title="p">
        <span class="ico">📄</span>
        <span class="path">{{ p }}</span>
        <button class="x" type="button" title="移除" @click="detach(p)">×</button>
      </span>
    </div>

    <div class="box">
      <MenuList
        v-if="mode !== 'none'"
        :items="menuItems"
        :title="mode === 'command' ? '命令' : mode === 'mention' ? '引用' : mode === 'files' ? '添加文件引用' : ''"
        @pick="onPick"
        @close="closeMenu"
      />
      <textarea
        ref="box"
        v-model="text"
        class="input"
        rows="1"
        :disabled="store.approvals.length > 0"
        placeholder="发消息，/ 调用命令，@ 引用文件或会话"
        @input="syncTriggers"
        @keydown="onKeydown"
        @click="syncTriggers"
        @keyup="syncTriggers"
        @dragover.prevent
        @drop.prevent="onDrop"
      />
    </div>

    <div class="bar">
      <button class="tool" type="button" title="添加文件引用" @click="openFilePicker()">＋</button>
      <button class="pill" type="button" title="权限围栏" @click="openFenceMenu()">🛡 {{ fenceLabel }}</button>
      <button class="pill" type="button" title="切换模型" @click="openModelMenu()">{{ modelLabel }}</button>
      <button class="pill" type="button" title="思考深度" @click="openThinkMenu()">思考 {{ thinkLabel }}</button>

      <span class="spacer" />

      <span v-if="store.queued.length" class="queued" title="本轮结束后按顺序发送">
        已排队 {{ store.queued.length }} 条
        <button class="link" type="button" @click="clearQueued()">清空</button>
      </span>
      <span v-if="store.streaming" class="state">生成中…（Esc 中断）</span>
      <span v-else class="state dim">{{ text.length }} 字</span>
      <button v-if="store.streaming" class="btn stop" type="button" @click="interrupt()">中断</button>
      <button
        v-else
        class="btn send"
        type="button"
        :disabled="!text.trim() || store.approvals.length > 0"
        @click="onSubmit()"
      >
        发送
      </button>
    </div>
  </div>
</template>

<style scoped>
.composer {
  border: 1px solid var(--cell-alias-line);
  border-radius: var(--cell-radius-md);
  background: var(--cell-alias-bg-raised);
  padding: 8px 10px 6px;
}

.composer.waiting {
  border-color: var(--cell-alias-warn);
}

.veto {
  margin: 0 2px 8px;
  padding: 5px 8px;
  border-radius: var(--cell-radius-sm);
  background: var(--cell-alias-bg-raised-2);
  color: var(--cell-alias-warn);
  font-size: var(--cell-font-size-xs);
}

.rail {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 46%;
  border: 1px solid var(--cell-alias-line);
  border-radius: var(--cell-radius-pill);
  padding: 1px 4px 1px 8px;
  font-size: var(--cell-font-size-xs);
  color: var(--cell-alias-ink-dim);
  background: var(--cell-alias-bg-base);
}

.chip .path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip .x {
  border: 0;
  background: none;
  color: var(--cell-alias-ink-faint);
  padding: 0 4px;
}

.chip .x:hover {
  color: var(--cell-alias-bad);
}

.box {
  position: relative;
}

.input {
  width: 100%;
  border: 0;
  outline: 0;
  resize: none;
  background: transparent;
  color: var(--cell-alias-ink);
  line-height: 21px;
  max-height: calc(21px * 14);
  overflow-y: auto;
}

.input::placeholder {
  color: var(--cell-alias-ink-faint);
}

.input:disabled {
  opacity: 0.6;
}

.bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  flex-wrap: wrap;
}

.spacer {
  flex: 1;
}

.tool,
.pill {
  border: 1px solid var(--cell-alias-line);
  background: var(--cell-alias-bg-base);
  color: var(--cell-alias-ink-dim);
  border-radius: var(--cell-radius-pill);
  font-size: var(--cell-font-size-xs);
  padding: 2px 10px;
}

.tool {
  width: 26px;
  padding: 2px 0;
  font-size: var(--cell-font-size-sm);
}

.tool:hover,
.pill:hover {
  border-color: var(--cell-alias-accent);
  color: var(--cell-alias-ink);
}

.state {
  font-size: var(--cell-font-size-xs);
  color: var(--cell-alias-ink-dim);
}

.state.dim {
  color: var(--cell-alias-ink-faint);
}

.queued {
  font-size: var(--cell-font-size-xs);
  color: var(--cell-alias-accent);
}

.link {
  border: 0;
  background: none;
  color: inherit;
  text-decoration: underline;
  padding: 0 2px;
  font-size: inherit;
}

.btn {
  border: 1px solid var(--cell-alias-accent-line);
  border-radius: var(--cell-radius-pill);
  padding: 3px 16px;
  font-size: var(--cell-font-size-sm);
  font-weight: 600;
}

.btn.send {
  background: var(--cell-alias-accent);
  color: var(--cell-alias-ink-invert);
}

.btn.send:disabled {
  background: var(--cell-alias-bg-raised-2);
  color: var(--cell-alias-ink-faint);
  border-color: var(--cell-alias-line);
}

.btn.stop {
  background: var(--cell-alias-bad-soft);
  color: var(--cell-alias-bad);
  border-color: var(--cell-alias-bad-soft);
}
</style>
