// Failed-turn reporting: the bubble a person sees when a turn did not finish.
//
// This is the exact bug the user reported: a turn that aborted (no key, wrong
// base URL, provider down) left the conversation showing the user's message
// followed by nothing, while the shell reported the turn as done — because a
// failed turn writes no assistant record, and the transcript reload at the end
// of every turn erased the only trace. The kernel now emits an `error` frame
// with code turn_error plus turn_done.rc != 0; these tests pin that both
// signals are recognised, and that a user cancel is NOT mistaken for one.
//
// Run: bun test tests/
import { describe, expect, test } from 'bun:test'
import { turnFailureBubble, watchTurnFailures } from '../src/lib/turnFail'
import type { TurnEvent } from '../src/lib/api'

const err = (code: string, message: string): TurnEvent => ({ type: 'error', data: { code, message } })
const done = (rc: number, interrupted = false): TurnEvent => ({
    type: 'turn_done',
    data: { rc, interrupted },
})

function run(events: TurnEvent[]) {
    const seen: TurnEvent[] = []
    const watch = watchTurnFailures((e) => seen.push(e))
    for (const e of events) watch.onEvent(e)
    return { failures: watch.failures, seen }
}

describe('failed turn detection', () => {
    test('a finished turn is not a failure', () => {
        const { failures } = run([{ type: 'token', data: { text: 'hi' } }, done(0)])
        expect(failures).toEqual([])
    })

    test('an error frame plus rc != 0 is one failure, not two', () => {
        const { failures } = run([
            { type: 'output', data: { text: ' contacting...\n' } },
            err('turn_error', 'llm request failed after 1 attempt(s): HTTP 404 - a 404 usually means the base URL is wrong'),
            done(1),
        ])
        expect(failures.length).toBe(1)
        expect(failures[0].code).toBe('turn_error')
        expect(failures[0].message).toContain('404')
    })

    test('rc != 0 alone (no error frame) still counts', () => {
        // a kernel that only sets the exit code must not produce a silent "done"
        const { failures } = run([done(1)])
        expect(failures.length).toBe(1)
        expect(failures[0].code).toBe('turn_error')
    })

    test('a user cancel is a chosen stop, not a failure', () => {
        const { failures } = run([{ type: 'token', data: { text: 'partial' } }, done(1, true)])
        expect(failures).toEqual([])
    })

    test('events pass through untouched (the watcher never swallows)', () => {
        const events: TurnEvent[] = [{ type: 'token', data: { text: 'a' } }, err('internal', 'x'), done(1)]
        const { seen } = run(events)
        expect(seen).toEqual(events)
    })

    test('an error frame mid-stream does not stop the turn by itself', () => {
        // notices and per-tool errors arrive as error frames too; only rc decides
        const { failures } = run([err('internal', 'transient'), done(0)])
        expect(failures).toEqual([])
    })
})

describe('the failure bubble', () => {
    test('names the failure, the advice, and the kernel line', () => {
        const msg = turnFailureBubble(
            [{ code: 'turn_error', message: 'no api key for provider local (http://127.0.0.1:11434)' }],
            'm7',
        )
        expect(msg.role).toBe('assistant')
        expect(msg.key).toBe('m7')
        expect(msg.text).toContain('这一轮没有完成')
        // the friendly advice for turn_error mentions where to look
        expect(msg.text).toContain('重发一次')
        expect(msg.text).toContain('/v1')
        // and the raw kernel line, verbatim, for the bug report
        expect(msg.text).toContain('no api key for provider local')
    })

    test('the last failure wins when several arrive', () => {
        const msg = turnFailureBubble(
            [
                { code: 'internal', message: 'first' },
                { code: 'turn_error', message: 'llm request failed after 1 attempt(s): HTTP 404' },
            ],
            'm1',
        )
        expect(msg.text).toContain('llm request failed')
        expect(msg.text).not.toContain('first')
    })

    test('a failure with no message still renders advice', () => {
        const msg = turnFailureBubble([{ code: 'turn_error', message: '' }], 'm2')
        expect(msg.text).toContain('这一轮没有完成')
        expect(msg.text).not.toContain('内核：')
    })
})
