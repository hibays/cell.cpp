// Typed UI callbacks for the turn event stream.
//
// The shell used to handle every SSE event in one inline switch, so each new
// kernel event meant another branch in one function. This module exposes the
// callback registry the reference desktop harness uses instead: features
// subscribe to the event type they care about.
//
// Two guarantees:
//   * forward compatibility — an unknown event type parses to null and is
//     dropped, so a newer kernel cannot break an older shell;
//   * handler isolation — one throwing callback must not stop the others or
//     tear down the stream reader that is calling in.

import type { TurnEvent } from './api'

type Handler<K extends TurnEvent['type']> = (e: Extract<TurnEvent, { type: K }>) => void

export interface EventBus {
  on<K extends TurnEvent['type']>(type: K, fn: Handler<K>): () => void
  onAny(fn: (e: TurnEvent) => void): () => void
  emit(e: TurnEvent): void
  /** Parse a raw frame and emit it if it is understood; otherwise drop it. */
  emitRaw(raw: unknown): void
}

export interface EventBusOptions {
  /** Called when a handler throws. Silent by default so a bad subscriber never
   *  pollutes the turn — wire this to the logger to surface them. */
  onError?: (err: unknown) => void
}

const KNOWN_TYPES: ReadonlySet<string> = new Set([
  'turn_start',
  'output',
  'approval_request',
  'error',
  'turn_done',
  // semantic events (see lib/liveTurn.ts): a kernel that does not emit them yet
  // simply never sends them, and anything genuinely unknown is still dropped
  'token',
  'reasoning',
  'tool_call',
  'tool_result',
  'usage',
  'interrupt',
  'notice',
])

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : Number(str(v)) || 0
const bool = (v: unknown): boolean => v === true || v === 'true'

/**
 * Normalise one raw SSE frame. Returns null for anything not understood, which
 * the bus treats as "drop" — never as an error.
 */
export function parseEvent(raw: unknown): TurnEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const type = o['type']
  if (typeof type !== 'string' || !KNOWN_TYPES.has(type)) return null
  // every event carries a payload; a known type with none is a protocol error,
  // so it is dropped rather than synthesised into an empty event
  const rawData = o['data']
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return null
  const data = rawData as Record<string, unknown>

  switch (type) {
    case 'turn_start':
      return { type, data: { session: str(data['session']), model: str(data['model']) } }
    case 'output':
      return { type, data: { text: str(data['text']) } }
    case 'approval_request':
      return {
        type,
        data: {
          request_id: str(data['request_id']),
          tool: str(data['tool']),
          args: str(data['args']),
        },
      }
    case 'error':
      return { type, data: { code: str(data['code']), message: str(data['message']) } }
    case 'turn_done':
      return { type, data: { rc: num(data['rc']), interrupted: bool(data['interrupted']) } }
    case 'token':
      return { type, data: { text: str(data['text']) } }
    case 'reasoning':
      return { type, data: { text: str(data['text']) } }
    case 'tool_call':
      return { type, data: { id: str(data['id']), name: str(data['name']), args: str(data['args']) } }
    case 'tool_result':
      return {
        type,
        data: {
          id: str(data['id']),
          name: str(data['name']),
          status: str(data['status']),
          seconds: num(data['seconds']),
          output: str(data['output']),
          truncated: bool(data['truncated']),
        },
      }
    case 'usage':
      return {
        type,
        data: {
          in_tokens: num(data['in_tokens']),
          out_tokens: num(data['out_tokens']),
          total_tokens: num(data['total_tokens']),
          cached_tokens: num(data['cached_tokens']),
          prompt_tokens: num(data['prompt_tokens']),
          request_ms: num(data['request_ms']),
          decode_ms: num(data['decode_ms']),
        },
      }
    case 'interrupt':
      return { type, data: { partial_chars: num(data['partial_chars']) } }
    case 'notice':
      return {
        type,
        data: {
          id: str(data['id']),
          session: str(data['session']),
          from: str(data['from']),
          topic: str(data['topic']),
          body: str(data['body']),
          created_at: num(data['created_at']),
        },
      }
    default:
      return null
  }
}

export function createEventBus(opts: EventBusOptions = {}): EventBus {
  const typed = new Map<string, Set<(e: TurnEvent) => void>>()
  const any = new Set<(e: TurnEvent) => void>()

  const run = (fn: (e: TurnEvent) => void, e: TurnEvent) => {
    try {
      fn(e)
    } catch (err) {
      opts.onError?.(err)
    }
  }

  const emit = (e: TurnEvent) => {
    // snapshot first: delivery is to the subscribers as of emit start, so a
    // handler that subscribes or unsubscribes cannot alter this dispatch
    for (const fn of Array.from(typed.get(e.type) ?? [])) run(fn, e)
    for (const fn of Array.from(any)) run(fn, e)
  }

  return {
    on(type, fn) {
      let set = typed.get(type)
      if (!set) {
        set = new Set()
        typed.set(type, set)
      }
      const wrapped = fn as unknown as (e: TurnEvent) => void
      set.add(wrapped)
      return () => {
        set?.delete(wrapped)
      }
    },
    onAny(fn) {
      any.add(fn)
      return () => {
        any.delete(fn)
      }
    },
    // note: `emit` is a closure, not `this.emit`, so emitRaw stays safe when it
    // is handed to the SSE reader as a bare callback reference
    emit,
    emitRaw(raw) {
      const e = parseEvent(raw)
      if (e) emit(e)
    },
  }
}
