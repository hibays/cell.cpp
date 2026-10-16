// Teamwork form and progress helpers.
//
// The shell can already see sub-agents; this is the other half — turning a
// couple of lines the user typed into a job config, and turning a job's status
// into something a person can read. Pure, so the rules are testable without a
// kernel: what a task list becomes, what each status means, and which control a
// job currently offers.

import type { TeamworkJob, TeamworkJobInput } from './api'

/** Job statuses the kernel reports, with the words the panel shows. */
export const JOB_STATUS: Record<string, string> = {
  pending: '待运行',
  running: '进行中',
  waiting: '已暂停',
  completed: '已完成',
  failed: '失败',
  stopped: '已停止',
}

export function jobStatusLabel(status: string): string {
  return JOB_STATUS[status] ?? status
}

export function jobStatusTone(status: string): 'run' | 'wait' | 'done' | 'bad' {
  if (status === 'running') return 'run'
  if (status === 'pending' || status === 'waiting' || status === 'stopped') return 'wait'
  if (status === 'completed') return 'done'
  return 'bad'
}

/**
 * Build a job config from the lines the user typed: one task per line, blanks
 * dropped. A single task still produces one worker — the kernel assigns the
 * name, so sending a name here would just be ignored.
 */
export function buildJobInput(tasks: string[], mode: 'serial' | 'parallel'): TeamworkJobInput {
  const works = tasks
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
  return { 'work-type': mode, list: works.map((works) => ({ works })) }
}

/** What the launcher refuses to send, in the user's words. */
export function jobInputError(tasks: string[], maxChildren: number): string | null {
  const works = tasks.map((t) => t.trim()).filter((t) => t.length > 0)
  if (!works.length) return '至少写一条任务（每行一条）'
  if (works.length > maxChildren) return `最多 ${maxChildren} 名子智能体，你写了 ${works.length} 条`
  if (works.some((t) => t.length > 2000)) return '单条任务太长了（上限 2000 字）'
  return null
}

export interface JobProgress {
  total: number
  done: number
  running: number
  failed: number
  toolCalls: number
  tokens: number
}

/** Fold a job's worker rows into one line the header can show. */
export function jobProgress(job: TeamworkJob): JobProgress {
  const p: JobProgress = { total: job.workers?.length ?? 0, done: 0, running: 0, failed: 0, toolCalls: 0, tokens: 0 }
  for (const w of job.workers ?? []) {
    if (w.status === 'ok') p.done++
    else if (w.status === 'running') p.running++
    else if (w.status === 'failed' || w.status === 'incomplete') p.failed++
    p.toolCalls += w.tool_calls ?? 0
  }
  return p
}

export function progressLine(job: TeamworkJob): string {
  const p = jobProgress(job)
  const bits: string[] = []
  if (p.total) bits.push(`${p.done}/${p.total} 完成`)
  if (p.running) bits.push(`${p.running} 进行中`)
  if (p.failed) bits.push(`${p.failed} 未完成`)
  if (p.toolCalls) bits.push(`${p.toolCalls} 步`)
  return bits.join(' · ')
}

/** Which control the job offers right now; a button that does nothing is worse
 *  than no button, so this is the single source of truth for the row. */
export function jobControls(job: TeamworkJob): { run: boolean; stop: boolean; resume: boolean; remove: boolean } {
  const status = job.status ?? 'pending'
  const running = status === 'running'
  const finished = status === 'completed' || status === 'failed'
  const stopped = status === 'waiting' || status === 'stopped' || !!job.stopped
  return {
    run: !running && !finished && !stopped && (job.workers?.length ?? 0) > 0,
    stop: running,
    resume: !running && stopped,
    // completed jobs stay protected over REST (the CLI is the trusted channel)
    remove: !running && !finished,
  }
}