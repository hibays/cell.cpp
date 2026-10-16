// Failures in the shell's own voice.
//
// `classifyError` is the taxonomy: stable codes, retryability, an action. It is
// deliberately in English because it is a contract with code. What a *person*
// reads is this module's job — and the thing it must never do is pass a browser
// message straight through. "TypeError: Failed to fetch" is what a user sees
// when the shell shows `String(e)`, and it explains nothing at all.

import { classifyError } from './errors'

const BY_CODE: Record<string, string> = {
  transport: '连不上本地内核（cellui 里的 cell --serve）：它可能正在启动、已经退出，或被代理/防火墙挡了。',
  unauthorized: '本地内核的令牌不匹配，重启 cellui 即可。',
  shutting_down: '内核正在退出。',
  provider_unreachable: '服务商端点连不上：检查端点地址与代理设置。',
  provider_rejected: '服务商拒绝了请求：多半是密钥或模型名不对。',
  rate_limit: '服务商限流了，过一会儿再试。',
  context_window: '上下文超出模型窗口：压缩一次或新开会话。',
  tool_blocked: '工具调用被沙箱或策略拦下了。',
  approval_denied: '这次审批被拒绝了。',
  approval_timeout: '审批超时，按 fail-closed 处理。',
  payload_too_large: '内容太长，发不上去。',
  not_found: '目标不存在（可能已被删除或归档）。',
  bad_request: '请求被内核拒绝了。',
  forbidden: '这个操作需要更高权限。',
  internal: '内核内部错误。',
}

/**
 * One sentence a person can act on. Known codes get the shell's own wording;
 * anything else keeps the classified title plus the raw message, because an
 * unclassified failure is exactly the case where detail helps.
 */
export function friendlyError(e: unknown): string {
  const v = classifyError(e)
  const known = BY_CODE[v.code]
  if (known) return known
  // not `String(e)`: a thrown object with no toString would render "[object Object]"
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  // never surface a bare network message: it is the browser's wording, not ours
  const bare = /^(failed to fetch|networkerror|load failed|fetch failed)$/i.test(raw.trim())
  return bare ? v.title : `${v.title}${raw ? ` — ${raw}` : ''}`
}

/**
 * For the background refreshers (logs, jobs, approvals, usage): a transient
 * failure is not news. Try once more shortly, and if that fails too, stay quiet
 * — the next tick will try again, and a pane that flashes an error every three
 * seconds is worse than a pane that is briefly stale.
 */
export async function pollQuiet<T>(fn: () => Promise<T>, retryMs = 500): Promise<T | null> {
  try {
    return await fn()
  } catch {
    await new Promise((r) => setTimeout(r, retryMs))
    try {
      return await fn()
    } catch {
      return null
    }
  }
}
