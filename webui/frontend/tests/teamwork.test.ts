// Teamwork form and progress tests.
//
// The rules here are the ones a button depends on: what the launcher sends, what
// it refuses to send, and which control a job offers — a row that offers "运行"
// on a running job is a lie the kernel would answer with a 400.
//
// Run: bun test tests/
import { describe, expect, test } from 'bun:test'
import {
  buildJobInput,
  jobControls,
  jobInputError,
  jobProgress,
  jobStatusLabel,
  jobStatusTone,
  progressLine,
} from '../src/lib/teamwork'
import type { TeamworkJob, TeamworkWorker } from '../src/lib/api'

const worker = (name: string, status: string, tool_calls = 0): TeamworkWorker => ({
  name,
  stage: 0,
  provider: 'mock',
  model: 'm',
  status,
  rounds: 1,
  tool_calls,
})
const job = (status: string, workers: TeamworkWorker[], extra: Partial<TeamworkJob> = {}): TeamworkJob => ({
  id: 'job-1',
  session: 's',
  status,
  work_type: 'serial',
  error: '',
  created: '2026-10-16 12:00',
  current_stage: 0,
  is_workflow: false,
  stages: [],
  workers,
  ...extra,
})

describe('building a job from what the user typed', () => {
  test('one task per line, blanks dropped, no names invented', () => {
    const input = buildJobInput(['审一遍 SSE', '', '  补 e2e 门禁  '], 'parallel')
    expect(input['work-type']).toBe('parallel')
    expect(input.list?.map((w) => w.works)).toEqual(['审一遍 SSE', '补 e2e 门禁'])
    // the kernel assigns worker_N; a name here would only be overwritten
    expect(input.list?.every((w) => !('name' in w))).toBe(true)
  })

  test('it refuses the forms the kernel would reject anyway', () => {
    expect(jobInputError(['', '   '], 8)).toBe('至少写一条任务（每行一条）')
    expect(jobInputError(['a', 'b', 'c'], 2)).toContain('最多 2 名')
    expect(jobInputError(['x'.repeat(2001)], 8)).toContain('2000')
    expect(jobInputError(['ok'], 8)).toBeNull()
  })
})

describe('status vocabulary', () => {
  test('every kernel status has words, and an unknown one shows itself', () => {
    expect(jobStatusLabel('running')).toBe('进行中')
    expect(jobStatusLabel('waiting')).toBe('已暂停')
    expect(jobStatusLabel('completed')).toBe('已完成')
    expect(jobStatusLabel('mystery')).toBe('mystery')
  })

  test('tone drives the colour, so it must never be "done" for a failure', () => {
    expect(jobStatusTone('running')).toBe('run')
    expect(jobStatusTone('pending')).toBe('wait')
    expect(jobStatusTone('completed')).toBe('done')
    expect(jobStatusTone('failed')).toBe('bad')
  })
})

describe('progress', () => {
  test('counts by status and sums the steps', () => {
    const p = jobProgress(
      job('running', [worker('w0', 'ok', 4), worker('w1', 'running', 2), worker('w2', 'failed')]),
    )
    expect(p).toMatchObject({ total: 3, done: 1, running: 1, failed: 1, toolCalls: 6 })
    expect(progressLine(job('running', [worker('w0', 'ok', 4), worker('w1', 'running', 2)]))).toBe(
      '1/2 完成 · 1 进行中 · 6 步',
    )
  })

  test('a job with no workers says nothing rather than 0/0', () => {
    expect(progressLine(job('pending', []))).toBe('')
  })
})

describe('which control a job offers', () => {
  test('pending with workers can run, and a stopped one can resume', () => {
    expect(jobControls(job('pending', [worker('w0', 'pending')]))).toMatchObject({ run: true, stop: false })
    expect(jobControls(job('waiting', [worker('w0', 'pending')]))).toMatchObject({ run: false, resume: true })
    expect(jobControls(job('waiting', [worker('w0', 'pending')], { stopped: true }))).toMatchObject({
      resume: true,
    })
  })

  test('running offers stop and nothing else', () => {
    expect(jobControls(job('running', [worker('w0', 'running')]))).toMatchObject({
      run: false,
      stop: true,
      resume: false,
      remove: false,
    })
  })

  test('a job with no workers cannot be run, and a finished one cannot be removed', () => {
    expect(jobControls(job('pending', [])).run).toBe(false)
    expect(jobControls(job('completed', [worker('w0', 'ok')])).remove).toBe(false)
    expect(jobControls(job('failed', [worker('w0', 'failed')])).remove).toBe(false)
  })
})