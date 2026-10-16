// The bubble a failed turn leaves behind, and the watcher that decides a turn
// failed at all.
//
// A turn that aborts (no key, provider error, round limit) never becomes an
// assistant message on disk — so the transcript reload that ends every turn
// would otherwise erase the only trace of the failure, and the conversation
// would show the user's message followed by nothing, exactly as if the turn had
// finished. The kernel reports these as an `error` event carrying code
// `turn_error` plus `turn_done.rc != 0`; this module turns that signal into
// something a person can read.
//
// Pure on purpose: the store wires it into send()/resume(), the tests drive it
// directly.
import { friendlyError } from './friendly'
import type { UiMessage } from './transcript'
import type { TurnEvent } from './api'

export interface TurnFailure {
    code: string
    message: string
}

export function turnFailureBubble(failures: TurnFailure[], key: string): UiMessage {
    const last = failures[failures.length - 1]
    const advice = friendlyError({ code: last.code, message: last.message })
    const detail = last.message ? `\n\n内核：${last.message}` : ''
    return { key, role: 'assistant', text: `**这一轮没有完成。** ${advice}${detail}` }
}

/**
 * Watch one turn's events for the failure signals the kernel emits.
 *
 * `turn_done.rc != 0` is the verdict — it is the only thing that says the turn
 * did not finish, and it is what the kernel itself gates its turn_error frame
 * on. An `error` frame alone is not a verdict: capture can fail while the turn
 * itself completes, and that must not read as "这一轮没有完成". The frame's job
 * is to name the cause, so the last one before the verdict wins. A user cancel
 * reports `interrupted` and is a chosen stop, not a failure. rc != 0 with no
 * error frame at all (an older kernel) still counts.
 */
export function watchTurnFailures(
    onEvent: (e: TurnEvent) => void,
): { onEvent: (e: TurnEvent) => void; failures: TurnFailure[] } {
    const errors: TurnFailure[] = []
    const failures: TurnFailure[] = []
    return {
        failures,
        onEvent(e) {
            if (e.type === 'error') errors.push({ code: e.data.code, message: e.data.message })
            if (e.type === 'turn_done' && e.data.rc !== 0 && !e.data.interrupted)
                failures.push(errors.length ? errors[errors.length - 1] : { code: 'turn_error', message: '' })
            onEvent(e)
        },
    }
}
