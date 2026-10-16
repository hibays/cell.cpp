<script setup lang="ts">
import { computed, ref } from 'vue'
import { api } from '../lib/api'
import { bridge, errorMessage } from '../lib/bridge'
import { store, toast } from '../store'

/**
 * Two exports, because there are two hosts. The native shell writes a
 * self-contained HTML through the bridge and reveals it in the file manager;
 * a browser has neither, so the kernel's `GET /sessions/{id}/export?format=md`
 * feeds a download instead. Batch and "all" need the shell: they write one file
 * per session on disk, and a download prompt per session would be worse than
 * saying so.
 */
const hasShell = bridge.available() // decided once: the shell never appears mid-session

function download(name: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // the object URL keeps the blob alive until it is revoked
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

async function downloadMarkdown(sid: string): Promise<void> {
  const r = await api.exportMarkdown(sid)
  if (!r.count) {
    toast('warn', '这个会话还没有记录')
    return
  }
  download(`cell-${sid.slice(-12)}.md`, r.markdown, 'text/markdown')
  toast('ok', `已下载 Markdown（${r.count} 条消息）`)
}

const selected = ref<Set<string>>(new Set())

const allIds = computed(() => store.sessions.map((s) => s.id))
const allSelected = computed(() => allIds.value.length > 0 && selected.value.size === allIds.value.length)

function toggle(id: string): void {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function toggleAll(): void {
  selected.value = allSelected.value ? new Set() : new Set(allIds.value)
}

async function run(kind: 'current' | 'batch' | 'all', id?: string): Promise<void> {
  try {
    if (kind === 'current') {
      const sid = id ?? store.currentSession
      if (!sid) {
        toast('warn', '没有活动会话')
        return
      }
      if (!hasShell) {
        await downloadMarkdown(sid)
        return
      }
      const r = await bridge.exportSession(sid)
      if (r.ok) {
        toast('ok', `已导出：${r.path}`)
        await bridge.reveal(r.path!)
      } else toast('bad', r.error ?? '导出失败')
      return
    }
    const ids = kind === 'all' ? allIds.value : [...selected.value]
    if (ids.length === 0) {
      toast('warn', kind === 'batch' ? '请先勾选要导出的会话' : '没有可导出的会话')
      return
    }
    if (!hasShell) {
      toast('warn', '批量导出需要桌面壳（每个会话一个文件并打开文件夹）')
      return
    }
    const results = await bridge.exportBatch(ids)
    const ok = results.filter((r) => r.path).length
    const bad = results.length - ok
    toast(bad ? 'warn' : 'ok', `导出完成：${ok} 成功${bad ? `，${bad} 失败` : ''}`)
  } catch (e) {
    toast('bad', errorMessage(e))
  }
}
</script>

<template>
  <div class="export">
    <h3>导出</h3>
    <p class="desc">
      导出自包含 HTML（与 CLI <code>/export</code> 同一渲染器，含 Teamwork 子代理面板）。
      <template v-if="!hasShell">
        当前没有桌面壳：单会话导出改为下载 Markdown，批量与全量需要桌面壳。
      </template>
    </p>

    <div class="actions">
      <button class="row primary-row" @click="run('current')">
        <span class="label">{{ hasShell ? '导出当前会话' : '下载当前会话（Markdown）' }}</span>
        <span class="hint">{{ hasShell ? '侧栏/聊天中正在进行的会话' : '经 REST 导出，浏览器直接下载' }}</span>
      </button>
      <button class="row" :disabled="!selected.size" @click="run('batch')">
        <span class="label">批量导出所选（{{ selected.size }}）</span>
        <span class="hint">勾选下方会话后一次性导出</span>
      </button>
      <button class="row" @click="run('all')">
        <span class="label">全量导出所有会话</span>
        <span class="hint">磁盘上的每个会话各出一个 HTML</span>
      </button>
    </div>

    <div class="sessions">
      <div class="shead">
        <label class="check"><input type="checkbox" :checked="allSelected" @change="toggleAll()" /></label>
        <span class="id">会话</span>
        <span class="msgs">消息</span>
      </div>
      <div
        v-for="s in store.sessions"
        :key="s.id"
        class="srow"
        :class="{ on: s.id === store.currentSession }"
      >
        <label class="check"
          ><input type="checkbox" :checked="selected.has(s.id)" @change="toggle(s.id)"
        /></label>
        <span class="id" :title="s.id">{{ s.id.slice(-12) }}</span>
        <span class="cwd" :title="s.cwd">{{ s.cwd }}</span>
        <span class="msgs">{{ s.messages }}</span>
        <button class="one" @click="run('current', s.id)">导出</button>
      </div>
      <p v-if="!store.sessions.length" class="empty">还没有会话</p>
    </div>
  </div>
</template>

<style scoped>
.export {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

h3 {
  margin: 0 0 2px;
  font-size: 15px;
}

.desc {
  margin: 0 0 8px;
  color: var(--ink-dim);
  font-size: 12.5px;
}

code {
  font-family: var(--mono);
  background: var(--bg-elev-2);
  border-radius: 4px;
  padding: 1px 5px;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.row {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  text-align: left;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--bg-elev);
  padding: 10px 14px;
}

.row:hover:not(:disabled) {
  border-color: var(--accent);
}

.row:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.primary-row {
  border-color: rgba(59, 130, 246, 0.4);
  background: var(--accent-soft);
}

.label {
  font-weight: 600;
  font-size: 13.5px;
}

.hint {
  color: var(--ink-faint);
  font-size: 12px;
}

.sessions {
  margin-top: 10px;
  border-top: 1px solid var(--line-soft);
  max-height: 300px;
  overflow: auto;
}

.shead,
.srow {
  display: grid;
  grid-template-columns: 28px 110px 1fr 44px 56px;
  align-items: center;
  gap: 8px;
  padding: 7px 2px;
  border-bottom: 1px solid var(--line-soft);
  font-size: 12px;
}

.shead {
  color: var(--ink-faint);
  position: sticky;
  top: 0;
  background: var(--bg-elev);
}

.srow.on .id {
  color: #93c5fd;
}

.check {
  display: grid;
  place-items: center;
}

.id {
  font-family: var(--mono);
  color: var(--ink-dim);
}

.cwd {
  color: var(--ink-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.msgs {
  color: var(--ink-faint);
  font-family: var(--mono);
  text-align: right;
}

.one {
  border: 1px solid var(--line);
  background: var(--bg-elev-2);
  border-radius: 6px;
  padding: 3px 0;
  font-size: 12px;
}

.empty {
  color: var(--ink-faint);
  font-size: 12.5px;
  text-align: center;
  margin-top: 20px;
}
</style>
