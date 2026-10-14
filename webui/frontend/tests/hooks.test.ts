// webui hook <-> REST API cross-contract tests.
//
// Two halves, both about the seam between the native bridge and the agent API:
//
//   Part A (static, always runs): every hook cellui.cpp binds via webui_bind()
//   must be exactly the set the TS layer resolves and env.d.ts declares. This is
//   the drift that silently breaks the shell — if either side renames or forgets
//   a hook, resolveNative() returns undefined and the UI degrades to "kernel not
//   ready" with no build error anywhere.
//
//   Part B (joint, requires CELL_BIN): install a fake native bridge whose
//   cell_bootstrap returns a *real* kernel's base URL + token, then drive the
//   whole ApiClient surface through that discovery payload. If the hook's payload
//   and the REST API ever disagree, this fails — that is the cross-check.
//   The CORS assertion lives here too: the UI runs on WebUI's port and calls the
//   kernel on another port, i.e. cross-origin, so the bridge is useless without it.
//
// Run: bun test tests/
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { ApiClient } from '../src/lib/api'
import { bridge } from '../src/lib/bridge'

// tests/ -> ../../cellui.cpp (webui/cellui.cpp), ../src/... (frontend/src/...)
const CELLUI_SRC = `${import.meta.dir}/../../cellui.cpp`
const BRIDGE_SRC = `${import.meta.dir}/../src/lib/bridge.ts`
const API_SRC = `${import.meta.dir}/../src/lib/api.ts`
const ENV_SRC = `${import.meta.dir}/../src/env.d.ts`

type Hook = (...args: unknown[]) => Promise<string>

function setHook(name: string, fn: Hook | undefined): void {
  const g = globalThis as unknown as Record<string, unknown>
  if (fn) g[name] = fn
  else delete g[name]
}

/** Names cellui.cpp publishes: `webui_bind(w, "cell_x", ...)`. */
function boundHooks(src: string): string[] {
  return [...src.matchAll(/webui_bind\s*\(\s*w\s*,\s*"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((n) => n.startsWith('cell_'))
    .sort()
}

/**
 * Hook names the TS layer references: any 'cell_*' literal in the bridge/api
 * sources. Deliberately broader than matching resolveNative('...') — some hooks
 * reach the resolver through a helper (bootstrap() goes via
 * waitForBridge('cell_bootstrap')), which a call-site regex would silently miss.
 */
function referencedHooks(...srcs: string[]): string[] {
  return [
    ...new Set([...srcs.join('\n').matchAll(/'(cell_[a-z_]+)'/g)].map((m) => m[1])),
  ].sort()
}

/** Method names declared on the CellNative interface in env.d.ts. */
function declaredHooks(src: string): string[] {
  return [...src.matchAll(/^\s*(cell_[a-z_]+)\s*\(/gm)].map((m) => m[1]).sort()
}

describe('native hook contract (cellui.cpp <-> TS)', () => {
  const bound = boundHooks(readFileSync(CELLUI_SRC, 'utf8'))
  const resolved = [...new Set(referencedHooks(readFileSync(BRIDGE_SRC, 'utf8'), readFileSync(API_SRC, 'utf8')))]
  const declared = declaredHooks(readFileSync(ENV_SRC, 'utf8'))

  test('cellui.cpp binds at least the lifecycle hooks', () => {
    expect(bound).toContain('cell_hello')
    expect(bound).toContain('cell_bootstrap')
  })

  test('every hook the TS layer resolves is bound in cellui.cpp', () => {
    // a missing binding = the UI silently degrades to "kernel not ready"
    expect(resolved.filter((n) => !bound.includes(n))).toEqual([])
  })

  test('every hook cellui.cpp binds is actually used by the TS layer', () => {
    // a binding nobody calls is dead native surface (or a forgotten UI wiring)
    expect(bound.filter((n) => !resolved.includes(n))).toEqual([])
  })

  test('env.d.ts declares exactly the bound hook set', () => {
    expect(declared).toEqual(bound)
  })

  test('bridge.available() tracks the cell_hello hook', () => {
    expect(bridge.available()).toBe(false)
    setHook('cell_hello', () => Promise.resolve('{}'))
    try {
      expect(bridge.available()).toBe(true)
    } finally {
      setHook('cell_hello', undefined)
    }
    expect(bridge.available()).toBe(false)
  })

  test('bridge helpers degrade gracefully with no native layer', async () => {
    // every helper must resolve (not throw) so `bun run dev` in a plain browser
    // keeps working — openExternal is excluded: it falls back to window.open
    expect(await bridge.exportSession('s1')).toMatchObject({ error: expect.stringContaining('dev mode') })
    expect(await bridge.exportBatch(['s1'])).toEqual([{ id: 's1', error: expect.stringContaining('dev mode') }])
    expect(await bridge.capabilities()).toEqual({ shell: 'browser' })
    await expect(bridge.reveal('/tmp')).resolves.toBeUndefined()
    await expect(bridge.notify('hi')).resolves.toBeUndefined()
  })
})

describe('hook discovery <-> REST API cross-talk (CELL_BIN)', () => {
  const bin = process.env.CELL_BIN

  test.skipIf(!bin)('bootstrap payload drives the whole ApiClient surface', async () => {
    const { mkdtempSync, writeFileSync, existsSync, readFileSync: read } = await import('node:fs')
    const { spawn } = await import('node:child_process')
    const os = await import('node:os')
    const net = await import('node:net')

    const root = mkdtempSync(`${os.tmpdir()}/cell-hooks-`)
    writeFileSync(
      `${root}/config.json`,
      JSON.stringify({
        // dead provider: this test never runs a turn, so it needs no LLM
        providers: [{ name: 'mock', style: 'openai', base: 'http://127.0.0.1:9/v1', key: 'k' }],
        current_provider: 'mock',
        current_model: 'mock-model',
        tools: false,
      }),
    )
    const port = await new Promise<number>((res) => {
      const s = net.createServer()
      s.listen(0, '127.0.0.1', () => {
        const p = (s.address() as { port: number }).port
        s.close(() => res(p))
      })
    })

    const proc = spawn(bin!, ['--serve', '--port', String(port), '--host', '127.0.0.1'], {
      cwd: root,
      env: { ...process.env, CELL_ROOT: root },
      stdio: 'ignore',
    })

    try {
      let token = ''
      const sj = `${root}/server.json`
      for (let i = 0; i < 100 && !token; i++) {
        if (existsSync(sj)) token = JSON.parse(read(sj, 'utf8')).token
        if (!token) await Bun.sleep(100)
      }
      expect(token).not.toBe('')

      // the hook payload the native layer would hand to the UI
      const base = `http://127.0.0.1:${port}/v1`
      setHook('cell_bootstrap', () =>
        Promise.resolve(
          JSON.stringify({
            version: '0.0.0-test',
            serve_ok: true,
            serve_error: '',
            uptime_s: 1,
            platform: ['test', 0],
            api: { base, token },
          }),
        ),
      )

      const api = new ApiClient()
      const boot = await api.bootstrap()
      expect(boot.api?.base).toBe(base)
      expect(boot.api?.token).toBe(token)

      // discovered credentials must be enough to drive the entire REST surface
      api.base = boot.api!.base
      api.token = boot.api!.token

      expect((await api.version()).version).toBeTypeOf('string')
      const health = (await api.health()) as { status: string }
      expect(health.status).toBe('ok')

      const created = await api.createSession()
      const sid = created.id
      expect(sid).toBeTruthy()
      // A session only materialises once it has content, so a brand-new empty
      // session is not listed yet and GET /messages 404s for it. That part of
      // the contract is exercised after a real turn by joint.test.ts and by
      // ctest cell.e2e_serve — asserting it here would encode non-behaviour.
      const listed = await api.listSessions()
      expect(listed.sessions).toBeInstanceOf(Array)
      expect(listed.current).toBeTypeOf('string')

      const cfg = await api.getConfig()
      expect(cfg).toHaveProperty('think_level')
      expect(cfg).toHaveProperty('current_model')

      const providers = await api.listProviders()
      expect(providers.providers).toBeInstanceOf(Array)

      expect((await api.skills()).skills).toBeInstanceOf(Array)
      expect(await api.usages()).toBeTruthy()
      expect((await api.notices()).pending).toBeInstanceOf(Array)
      expect((await api.listApprovals()).pending).toBeInstanceOf(Array)

      await api.deleteSession(sid)
      await expect(api.listSessions()).resolves.toBeTruthy()

      await api.shutdown()
      await new Promise<void>((res) => proc.once('exit', () => res()))
    } finally {
      setHook('cell_bootstrap', undefined)
      if (proc.exitCode === null) proc.kill()
    }
  }, 60000)

  test.skipIf(!bin)('kernel answers cross-origin (the bridge runs on another port)', async () => {
    const { mkdtempSync, writeFileSync, existsSync, readFileSync: read } = await import('node:fs')
    const { spawn } = await import('node:child_process')
    const os = await import('node:os')
    const net = await import('node:net')

    const root = mkdtempSync(`${os.tmpdir()}/cell-cors-`)
    writeFileSync(
      `${root}/config.json`,
      JSON.stringify({
        providers: [{ name: 'mock', style: 'openai', base: 'http://127.0.0.1:9/v1', key: 'k' }],
        current_provider: 'mock',
        current_model: 'mock-model',
        tools: false,
      }),
    )
    const port = await new Promise<number>((res) => {
      const s = net.createServer()
      s.listen(0, '127.0.0.1', () => {
        const p = (s.address() as { port: number }).port
        s.close(() => res(p))
      })
    })
    const proc = spawn(bin!, ['--serve', '--port', String(port), '--host', '127.0.0.1'], {
      cwd: root,
      env: { ...process.env, CELL_ROOT: root },
      stdio: 'ignore',
    })

    try {
      // wait for readiness via health (no token needed)
      const origin = 'http://localhost:1' // stands in for WebUI's own port
      const healthUrl = `http://127.0.0.1:${port}/v1/health`
      let ok = false
      for (let i = 0; i < 100 && !ok; i++) {
        const r = await fetch(healthUrl, { headers: { Origin: origin } }).catch(() => null)
        if (r && r.ok) ok = true
        else await Bun.sleep(100)
      }
      expect(ok).toBe(true)

      // health
      const res = await fetch(healthUrl, { headers: { Origin: origin } })
      expect(res.headers.get('access-control-allow-origin')).toBe('*')

      // preflight
      const pre = await fetch(`http://127.0.0.1:${port}/v1/version`, {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
      })
      expect(pre.status).toBe(204)
      expect(pre.headers.get('access-control-allow-origin')).toBe('*')

      // shutdown is authenticated (like every control endpoint), so the token
      // from the discovery file is required — an unauthenticated POST here is a
      // 401 and would leave the kernel running.
      let token = ''
      const sj = `${root}/server.json`
      for (let i = 0; i < 100 && !token; i++) {
        if (existsSync(sj)) token = JSON.parse(read(sj, 'utf8')).token
        if (!token) await Bun.sleep(100)
      }
      const shut = await fetch(`http://127.0.0.1:${port}/v1/shutdown`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(shut.ok).toBe(true)
      await new Promise<void>((res2) => proc.once('exit', () => res2()))
    } finally {
      if (proc.exitCode === null) proc.kill()
    }
  }, 60000)
})
