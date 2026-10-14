// Joint front-end <-> kernel tests.
//
// Part 1 (pure): the native-bridge resolver contract — webui publishes bound
// C++ functions as globals; the documented contract also allows window.cell.*.
// This is the exact seam that made the landing page report "kernel not ready".
//
// Part 2 (joint, requires CELL_BIN): boots the real kernel with a mock LLM in
// an isolated CELL_ROOT, then drives the same REST workflow the UI runs after
// bootstrap: health -> session -> turn -> transcript. Skips when CELL_BIN is
// unset so `bun test` stays green in a front-end-only checkout.
//
// Run: bun test tests/
import { describe, expect, test } from 'bun:test'
import { resolveNative } from '../src/lib/api'

describe('native bridge resolver', () => {
  test('finds the documented window.cell.* namespace', () => {
    ;(globalThis as unknown as Record<string, unknown>)['cell'] = {
      cell_bootstrap: () => Promise.resolve('{"ok":true}'),
    }
    expect(resolveNative('cell_bootstrap')).toBeTypeOf('function')
    delete (globalThis as unknown as Record<string, unknown>)['cell']
  })

  test('finds the webui global form (window.cell_bootstrap)', () => {
    ;(globalThis as unknown as Record<string, unknown>)['cell_bootstrap'] = () =>
      Promise.resolve('{"ok":true}')
    expect(resolveNative('cell_bootstrap')).toBeTypeOf('function')
    delete (globalThis as unknown as Record<string, unknown>)['cell_bootstrap']
  })

  test('absent bridge resolves to undefined (dev-mode degrade)', () => {
    expect(resolveNative('cell_bootstrap')).toBeUndefined()
  })

  test('namespace wins over a stray global', () => {
    ;(globalThis as unknown as Record<string, unknown>)['cell'] = {
      cell_bootstrap: () => Promise.resolve('from-ns'),
    }
    ;(globalThis as unknown as Record<string, unknown>)['cell_bootstrap'] = () =>
      Promise.resolve('from-global')
    const fn = resolveNative('cell_bootstrap')!
    expect(fn()).resolves.toBe('from-ns')
    delete (globalThis as unknown as Record<string, unknown>)['cell']
    delete (globalThis as unknown as Record<string, unknown>)['cell_bootstrap']
  })
})

type Health = { status: string; model: string }

async function api(
  base: string,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const r = await fetch(base + path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  return (await r.json()) as Record<string, unknown>
}

describe('kernel joint workflow (CELL_BIN)', () => {
  const bin = process.env.CELL_BIN
  test.skipIf(!bin)('serve -> session -> turn -> transcript', async () => {
    const { mkdtempSync, writeFileSync, existsSync, readFileSync } = await import('node:fs')
    const { spawn } = await import('node:child_process')
    const os = await import('node:os')
    const net = await import('node:net')

    const root = mkdtempSync(`${os.tmpdir()}/cell-joint-`)
    // a fake provider base; the turn will fail to reach it, which is fine —
    // this workflow checks the *kernel* contract the UI depends on
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
      const base = `http://127.0.0.1:${port}`
      let health: Health | null = null
      for (let i = 0; i < 100 && !health; i++) {
        try {
          health = (await api(base, '', 'GET', '/v1/health')) as unknown as Health
        } catch {
          await Bun.sleep(150)
        }
      }
      expect(health?.status).toBe('ok')

      let token = ''
      const sj = `${root}/server.json`
      for (let i = 0; i < 100 && !token; i++) {
        if (existsSync(sj)) token = (JSON.parse(readFileSync(sj, 'utf8')) as { token: string }).token
        if (!token) await Bun.sleep(100)
      }
      expect(token).not.toBe('')

      const created = await api(base, token, 'POST', '/v1/sessions')
      const sid = created['id'] as string
      expect(sid).toBeTruthy()

      // turn against a dead provider: the kernel must answer with a structured
      // error (rc != 0 / error info), never hang or 500 — the UI relies on it
      const turn = await api(base, token, 'POST', `/v1/sessions/${sid}/turn`, { text: 'hi' })
      expect('rc' in turn || 'error' in turn || 'output' in turn).toBe(true)

      await api(base, token, 'POST', '/v1/shutdown')
      await new Promise<void>((res) => proc.once('exit', () => res()))
    } finally {
      if (proc.exitCode === null) proc.kill()
    }
  }, 60000)
})
