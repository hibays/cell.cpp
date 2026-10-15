// Agent service client — teamwork + compaction REST contract (docs/RESTful.md §3.9).
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
})
