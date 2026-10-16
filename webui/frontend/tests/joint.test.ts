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
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { ApiClient, resolveNative } from '../src/lib/api'

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

      // The sidebar groups sessions by workspace and shows a title plus a
      // relative age, so the list must carry `title` and `updated_at` — the id
      // alone cannot express either. Both are derived by the kernel: the title
      // from the first user turn, the timestamp from the transcript's mtime.
      const listed = (await api(base, token, 'GET', '/v1/sessions')) as unknown as {
        sessions: Array<Record<string, unknown>>
      }
      const row = listed.sessions.find((s) => s.id === sid)
      expect(row).toBeTruthy()
      expect(typeof row!.title).toBe('string')
      expect(row!.title).toBe('hi')
      expect(typeof row!.updated_at).toBe('number')
      expect(row!.updated_at as number).toBeGreaterThan(0)

      await api(base, token, 'POST', '/v1/shutdown')
      await new Promise<void>((res) => proc.once('exit', () => res()))
    } finally {
      if (proc.exitCode === null) proc.kill()
    }
  }, 60000)
})

// -----------------------------------------------------------------------------
//  WebUI hook side: the landing page reports "kernel not ready" when the native
//  bridge ApiClient.bootstrap() awaits never becomes available. Two independent
//  regressions caused this historically:
//    (a) the embedded SPA never loaded /webui.js, so window.cell_bootstrap was
//        simply undefined;
//    (b) the bridge is constructed on DOMContentLoaded while this ES module runs
//        earlier, so bootstrap() must poll instead of failing on the first check.
//  These tests lock both behaviours in, and run with `bun test` (no kernel).
// -----------------------------------------------------------------------------
describe('cellui bootstrap over webui hook', () => {
  test('bootstrap() resolves once the bridge appears (DOMContentLoaded race)', async () => {
    const api = new ApiClient()
    // simulate WebUI constructing the bridge on DOMContentLoaded, i.e. a few
    // hundred ms after this module executed
    setTimeout(() => {
      ;(globalThis as unknown as Record<string, unknown>)['cell_bootstrap'] = () =>
        Promise.resolve(
          JSON.stringify({ version: '0.1.0', serve_ok: true, uptime_s: 1, platform: ['win', 0] }),
        )
    }, 120)
    const boot = await api.bootstrap()
    expect(boot.version).toBe('0.1.0')
    expect(boot.serve_ok).toBe(true)
    delete (globalThis as unknown as Record<string, unknown>)['cell_bootstrap']
  })

  test('bootstrap() rejects when the bridge never loads (dev-mode guard)', async () => {
    const api = new ApiClient()
    expect(api.bootstrap()).rejects.toThrow(/native bridge unavailable/)
  })

  test('resolves the window.cell.* namespace if the shell binds that form', async () => {
    const api = new ApiClient()
    ;(globalThis as unknown as Record<string, unknown>)['cell'] = {
      cell_bootstrap: () =>
        Promise.resolve(
          JSON.stringify({ version: '9.9.9', serve_ok: true, uptime_s: 0, platform: ['lin', 1] }),
        ),
    }
    const boot = await api.bootstrap()
    expect(boot.version).toBe('9.9.9')
    delete (globalThis as unknown as Record<string, unknown>)['cell']
  })
})

// Regression guard for the "内核未就绪" bug: the embedded SPA (after
// scripts/embed_webui.mjs packs it) must load /webui.js, or WebUI never binds
// window.cell_bootstrap and the GUI reports "kernel not ready". The source
// dist/index.html legitimately has no /webui.js — the injection happens in the
// embed step, so we run that step and inspect its generated header.
describe('built front-end embeds the native bridge', () => {
  const distPath = `${import.meta.dir}/../dist/index.html`
  const scriptPath = `${import.meta.dir}/../../scripts/embed_webui.mjs`
  const distExists = (() => {
    try {
      return readFileSync(distPath, 'utf8').includes('<div id="app">')
    } catch {
      return false
    }
  })()

  test.skipIf(!distExists)('embed_webui.mjs injects /webui.js into the embedded payload', () => {
    const outDir = `${tmpdir()}/cell-embed-check-${Date.now()}`
    const res = Bun.spawnSync({
      cmd: [process.execPath, scriptPath, outDir],
      cwd: `${import.meta.dir}/../..`,
    })
    expect(res.success).toBe(true)
    const header = readFileSync(`${outDir}/cellui_web.h`, 'utf8')
    expect(header).toContain('CELLUI_HAVE_EMBEDDED_WEB')
    expect(header).toContain('/webui.js')

    // The payload must be chunked. MSVC caps any single literal at ~16380 bytes
    // (C2026 "string too big, trailing characters truncated"), so emitting the
    // ~400 KiB bundle as one raw string compiles on GCC/Clang and fails only in
    // MSVC builds — exactly how the v0.1.1 release job first broke.
    const chunks = [...header.matchAll(/R"(cellui\w*)\(([\s\S]*?)\)\1"/g)].map((m) => m[2])
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThan(16380)

    // Lossless round-trip: joining the chunks must equal the reserved length.
    const reserved = Number(/out\.reserve\((\d+)\)/.exec(header)?.[1])
    expect(Number.isFinite(reserved)).toBe(true)
    const joined = chunks.join('')
    expect(joined.length).toBe(reserved)
    expect(joined).toContain('/webui.js')
    expect(joined.trimEnd().endsWith('</html>')).toBe(true)
  })
})
