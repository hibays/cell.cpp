// Agent service client — teamwork + compaction + skills REST contract
// (docs/RESTful.md §3.9).
//
// These pin the frontend's endpoint paths and the 409 error mapping so a kernel
// route rename or response-shape change breaks loudly here instead of silently
// at runtime. Run: bun test tests/
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { api } from '../src/lib/api'

function installFetch(handler: (url: string, init: RequestInit) => Response): void {
  globalThis.fetch = ((url: unknown, init?: unknown) =>
    Promise.resolve(handler(String(url), (init as RequestInit) ?? {}))) as typeof fetch
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('agent service client — teamwork + compaction contract', () => {
  beforeEach(() => {
    api.base = 'http://agent.test'
    api.token = 'tok'
  })
  afterEach(() => {
    api.base = ''
    api.token = ''
  })

  test('getSessionTeamworks GETs the per-session teamworks endpoint', async () => {
    const calls: string[] = []
    installFetch((url, init) => {
      calls.push(`${init.method ?? 'GET'} ${url}`)
      return jsonResponse({
        session: 'sid1',
        jobs: [
          {
            id: 'j1',
            session: 'sid1',
            status: 'done',
            work_type: 'serial',
            error: '',
            created: '',
            current_stage: 0,
            is_workflow: false,
            stages: [],
            workers: [],
          },
        ],
      })
    })
    const list = await api.getSessionTeamworks('sid1')
    expect(calls).toEqual(['GET http://agent.test/sessions/sid1/teamworks'])
    expect(list.jobs.length).toBe(1)
    expect(list.jobs[0].id).toBe('j1')
  })

  test('getTeamworks GETs the cross-session teamworks endpoint', async () => {
    const calls: string[] = []
    installFetch((url, init) => {
      calls.push(`${init.method ?? 'GET'} ${url}`)
      return jsonResponse({ jobs: [] })
    })
    const list = await api.getTeamworks()
    expect(calls).toEqual(['GET http://agent.test/teamworks'])
    expect(list.jobs).toEqual([])
  })

  test('compactSession POSTs the per-session compact endpoint', async () => {
    const calls: string[] = []
    installFetch((url, init) => {
      calls.push(`${init.method ?? 'GET'} ${url}`)
      return jsonResponse({ session: 'sid1', status: 'context compacted: 3 → 1', compacted: true, ok: true })
    })
    const r = await api.compactSession('sid1')
    expect(calls).toEqual(['POST http://agent.test/sessions/sid1/compact'])
    expect(r.ok).toBe(true)
    expect(r.compacted).toBe(true)
    expect(r.status).toContain('compacted')
  })

  test('compactSession maps the 409 busy code onto the thrown error', async () => {
    installFetch(() =>
      new Response(JSON.stringify({ error: { code: 'busy', message: 'a turn is running' } }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    let caught: { status?: number; code?: string } | null = null
    try {
      await api.compactSession('sid1')
    } catch (e) {
      caught = e as { status?: number; code?: string }
    }
    expect(caught).not.toBeNull()
    expect(caught!.status).toBe(409)
    expect(caught!.code).toBe('busy')
  })

  // ---- control endpoints (docs/RESTful.md §3.9 控制侧) -----------------------
  // One table pins every control path + HTTP method so a kernel rename or a
  // typo'd verb breaks here rather than in the panel.
  const controlCases: [string, (jobId: string) => Promise<unknown>, string, string][] = [
    ['deleteTeamworkJob', (j) => api.deleteTeamworkJob('sid1', j), 'DELETE', '/sessions/sid1/teamworks/j1'],
    ['stopTeamworkJob', (j) => api.stopTeamworkJob('sid1', j), 'POST', '/sessions/sid1/teamworks/j1/stop'],
    ['runTeamworkJob', (j) => api.runTeamworkJob('sid1', j), 'POST', '/sessions/sid1/teamworks/j1/run'],
    ['resumeTeamworkJob', (j) => api.resumeTeamworkJob('sid1', j), 'POST', '/sessions/sid1/teamworks/j1/resume'],
  ]

  for (const [name, call, method, path] of controlCases) {
    test(`${name} uses ${method} ${path}`, async () => {
      const calls: string[] = []
      installFetch((url, init) => {
        calls.push(`${init.method ?? 'GET'} ${url}`)
        return jsonResponse({ id: 'j1', session: 'sid1', ok: true, message: 'm' })
      })
      await call('j1')
      expect(calls).toEqual([`${method} http://agent.test${path}`])
    })
  }

  test('createTeamworkJob POSTs the job body to the per-session endpoint', async () => {
    let seenBody = ''
    const calls: string[] = []
    installFetch((url, init) => {
      calls.push(`${init.method ?? 'GET'} ${url}`)
      seenBody = typeof init.body === 'string' ? init.body : ''
      return jsonResponse({ id: 'j1', session: 'sid1', ok: true })
    })
    const r = await api.createTeamworkJob('sid1', { 'work-type': 'serial', list: [{ works: 'do x' }] })
    expect(calls).toEqual(['POST http://agent.test/sessions/sid1/teamworks'])
    expect(JSON.parse(seenBody)).toEqual({ 'work-type': 'serial', list: [{ works: 'do x' }] })
    expect(r.id).toBe('j1')
    expect(r.ok).toBe(true)
  })

  test('patchTeamworkJob PATCHes the job with the new definition', async () => {
    let seenBody = ''
    const calls: string[] = []
    installFetch((url, init) => {
      calls.push(`${init.method ?? 'GET'} ${url}`)
      seenBody = typeof init.body === 'string' ? init.body : ''
      return jsonResponse({ id: 'j1', session: 'sid1', ok: true, message: 'edited' })
    })
    await api.patchTeamworkJob('sid1', 'j1', { list: [{ works: 'do y' }] })
    expect(calls).toEqual(['PATCH http://agent.test/sessions/sid1/teamworks/j1'])
    expect(JSON.parse(seenBody)).toEqual({ list: [{ works: 'do y' }] })
  })

  test('appendTeamworkWorker POSTs one worker to the workers endpoint', async () => {
    let seenBody = ''
    const calls: string[] = []
    installFetch((url, init) => {
      calls.push(`${init.method ?? 'GET'} ${url}`)
      seenBody = typeof init.body === 'string' ? init.body : ''
      return jsonResponse({ id: 'j1', session: 'sid1', ok: true })
    })
    await api.appendTeamworkWorker('sid1', 'j1', { works: 'summarize the README' })
    expect(calls).toEqual(['POST http://agent.test/sessions/sid1/teamworks/j1/workers'])
    expect(JSON.parse(seenBody)).toEqual({ works: 'summarize the README' })
  })

  test('removeTeamworkWorker DELETEs a URL-encoded worker path', async () => {
    const calls: string[] = []
    installFetch((url, init) => {
      calls.push(`${init.method ?? 'GET'} ${url}`)
      return jsonResponse({ id: 'j1', session: 'sid1', worker: 'worker 1', ok: true })
    })
    const r = await api.removeTeamworkWorker('sid1', 'j1', 'worker 1')
    expect(calls).toEqual(['DELETE http://agent.test/sessions/sid1/teamworks/j1/workers/worker%201'])
    expect(r.worker).toBe('worker 1')
  })

  test('runTeamworkJob maps the 400 run_failed code onto the thrown error', async () => {
    installFetch(() =>
      new Response(JSON.stringify({ error: { code: 'run_failed', message: 'teamwork j1 has no child agents' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    let caught: { status?: number; code?: string; message?: string } | null = null
    try {
      await api.runTeamworkJob('sid1', 'j1')
    } catch (e) {
      caught = e as { status?: number; code?: string; message?: string }
    }
    expect(caught).not.toBeNull()
    expect(caught!.status).toBe(400)
    expect(caught!.code).toBe('run_failed')
    expect(caught!.message).toContain('no child agents')
  })

  // ---- skills ----------------------------------------------------------------
  test('skillContent GETs the URL-encoded per-skill endpoint', async () => {
    const calls: string[] = []
    installFetch((url, init) => {
      calls.push(`${init.method ?? 'GET'} ${url}`)
      return jsonResponse({ name: 'my skill', description: 'd', file: 'my skill.md', content: 'body' })
    })
    const r = await api.skillContent('my skill')
    expect(calls).toEqual(['GET http://agent.test/skills/my%20skill'])
    expect(r.content).toBe('body')
    expect(r.file).toBe('my skill.md')
  })

  test('skillContent maps the 404 skill_not_found code', async () => {
    installFetch(() =>
      new Response(JSON.stringify({ error: { code: 'skill_not_found', message: 'no skill named nope' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    let caught: { status?: number; code?: string } | null = null
    try {
      await api.skillContent('nope')
    } catch (e) {
      caught = e as { status?: number; code?: string }
    }
    expect(caught!.status).toBe(404)
    expect(caught!.code).toBe('skill_not_found')
  })

  test('loadSkill POSTs the session-scoped skill endpoint', async () => {
    const calls: string[] = []
    installFetch((url, init) => {
      calls.push(`${init.method ?? 'GET'} ${url}`)
      return jsonResponse({ session: 'sid1', name: 'my skill', loaded: true, chars: 42 })
    })
    const r = await api.loadSkill('sid1', 'my skill')
    expect(calls).toEqual(['POST http://agent.test/sessions/sid1/skills/my%20skill'])
    expect(r.loaded).toBe(true)
    expect(r.chars).toBe(42)
  })

  test('loadSkill maps the 409 busy code (a turn is running)', async () => {
    installFetch(() =>
      new Response(JSON.stringify({ error: { code: 'busy', message: 'a turn is running' } }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    let caught: { status?: number; code?: string } | null = null
    try {
      await api.loadSkill('sid1', 'sk')
    } catch (e) {
      caught = e as { status?: number; code?: string }
    }
    expect(caught!.status).toBe(409)
    expect(caught!.code).toBe('busy')
  })
})
