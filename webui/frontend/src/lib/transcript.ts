// Transcript normalisation — the UI's outermost untrusted boundary.
//
// The kernel hands back the raw provider transcript, so this sees whatever
// OpenAI- and Anthropic-shaped records the agent persisted, including records
// written by an older build. Three rules follow from that:
//
//   * never throw — one bad record must not blank the whole conversation;
//   * never invent content — an unrecognised record is dropped, not rendered
//     as an empty bubble;
//   * stable keys — the transcript is reloaded at the end of every turn, and a
//     key that drifts rebuilds the entire list's DOM each time.

export interface UiToolCall {
  id: string
  name: string
  args: string
  /** `failed` covers the kernel's failed / unknown / exception statuses. */
  status: 'running' | 'ok' | 'failed' | 'blocked' | 'denied'
  output: string
  seconds?: number
}

export interface UiMessage {
  key: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  text: string
  reasoning?: string
  tools?: UiToolCall[]
  ts?: number
}

type Json = Record<string, unknown>

function asRecord(v: unknown): Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : {}
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

/** Best-effort stringify that cannot throw on odd payloads. */
function stringify(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === undefined || v === null) return ''
  try {
    return JSON.stringify(v) ?? ''
  } catch {
    return ''
  }
}

interface Block {
  type?: string
  text?: string
  content?: unknown
  name?: string
  input?: unknown
  id?: string
  reasoning?: string
}

/** Flatten the text carriers of either provider's content shape. */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        const block = b as Block
        if (!block || typeof block !== 'object') return ''
        // 'text' is OpenAI chat + Anthropic; input_text/output_text are the
        // Responses-API spellings the kernel also persists
        if (
          (block.type === 'text' || block.type === 'input_text' || block.type === 'output_text') &&
          typeof block.text === 'string'
        ) {
          return block.text
        }
        if (typeof block.content === 'string') return block.content
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

/** Reasoning travels either as its own field or as a reasoning block. */
function extractReasoning(entry: Json, content: unknown): string | undefined {
  const direct = str(entry.reasoning_content) ?? str(entry.reasoning)
  if (direct) return direct
  if (Array.isArray(content)) {
    const parts = content
      .map((b) => {
        const block = b as Block
        if (block && typeof block === 'object' && block.type === 'reasoning') {
          return str(block.reasoning) ?? str(block.text) ?? ''
        }
        return ''
      })
      .filter(Boolean)
    if (parts.length) return parts.join('\n')
  }
  return undefined
}

/**
 * Tool calls arrive two ways: OpenAI's `tool_calls[]` (arguments as a JSON
 * string) and Anthropic's `tool_use` content blocks (input as an object).
 */
function extractTools(entry: Json, content: unknown): UiToolCall[] {
  const out: UiToolCall[] = []

  const calls = Array.isArray(entry.tool_calls) ? entry.tool_calls : []
  for (const raw of calls) {
    const call = asRecord(raw)
    const fn = asRecord(call.function)
    const name = str(fn.name) ?? str(call.name) ?? '?'
    out.push({
      id: str(call.id) ?? `call-${out.length}`,
      name,
      args: str(fn.arguments) ?? stringify(call.arguments),
      status: 'running',
      output: '',
    })
  }

  if (Array.isArray(content)) {
    for (const raw of content) {
      const block = raw as Block
      if (!block || typeof block !== 'object' || block.type !== 'tool_use') continue
      out.push({
        id: str(block.id) ?? `call-${out.length}`,
        name: str(block.name) ?? '?',
        args: stringify(block.input),
        status: 'running',
        output: '',
      })
    }
  }

  return out
}

export function normalizeTranscript(raw: unknown): UiMessage[] {
  if (!Array.isArray(raw)) return []
  const out: UiMessage[] = []
  // index by call id so a result can find its call even out of order
  const byId = new Map<string, UiToolCall>()

  const runningCard = (): UiToolCall | undefined => {
    for (let i = out.length - 1; i >= 0; i--) {
      const tools = out[i].tools
      if (!tools) continue
      const pending = tools.find((t) => t.status === 'running')
      if (pending) return pending
      break // the most recent tool-bearing message is exhausted
    }
    return undefined
  }

  for (const entry of raw) {
    const m = asRecord(entry)
    const role = str(m.role)

    if (role === 'tool') {
      const text = stringify(m.content)
      // prefer the explicit id; fall back to the first still-running call
      const target = (str(m.tool_call_id) ? byId.get(str(m.tool_call_id)!) : undefined) ?? runningCard()
      if (!target) continue // an orphan result would attach to nothing
      target.status = 'ok'
      target.output = text
      continue
    }

    if (role !== 'assistant' && role !== 'user') continue

    const content = m.content
    const text = extractText(content)
    const tools = role === 'assistant' ? extractTools(m, content) : []
    const reasoning = role === 'assistant' ? extractReasoning(m, content) : undefined

    if (role === 'user') {
      if (!text.trim()) continue
      out.push({ key: `k${out.length}`, role: 'user', text, ts: typeof m.ts === 'number' ? m.ts : undefined })
      continue
    }

    if (!text && !reasoning && tools.length === 0) continue
    for (const t of tools) byId.set(t.id, t)
    out.push({
      key: `k${out.length}`,
      role: 'assistant',
      text,
      reasoning,
      tools: tools.length ? tools : undefined,
      ts: typeof m.ts === 'number' ? m.ts : undefined,
    })
  }

  return out
}
