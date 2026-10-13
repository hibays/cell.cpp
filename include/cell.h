/* cell.h — stable C embedding surface for cell.cpp
 *
 * cell.cpp is a single-file AI coding agent. It can be consumed in three ways:
 *
 *   1. As a single-file executable:      g++ -std=c++26 -O2 cell.cpp -o cell -lcurl -lsodium
 *   2. As a shared library (DLL/SO/dylib) built by CMake, linked against this
 *      header — the intended path for desktop front-ends:
 *          Windows : cell.dll  + cell.lib (import library)
 *          Linux   : libcell.so
 *          macOS   : libcell.dylib
 *   3. As a static library (CMake option CELL_BUILD_STATIC).
 *
 * All entry points below are `extern "C"` with a stable, version-free ABI
 * (pointers and ints only), so a host program can bind to them from C, C++,
 * C#, Rust, Python (ctypes/cffi), etc.
 *
 * Threading / process model
 * -------------------------
 * The agent CLI owns process-global state (signal handlers, console mode,
 * stdio, current working directory, config root). Every entry point therefore
 * serializes on one process-wide lock: calls may happen from any single
 * thread, but never concurrently. Run blocking calls (cell_main,
 * cell_run_oneshot) on a worker thread of the host application.
 *
 *   cell_version()      — build identity ("0.1.0", "0.0.0-dev", ...)
 *   cell_selftest()     — run the built-in test suite, 0 = all passed
 *   cell_main()         — run the full CLI in-process (interactive REPL or
 *                         one-shot stdin, exactly like the binary)
 *   cell_run_oneshot()  — one message -> full agent turn -> reply text, with
 *                         stdio transparently captured; the pragmatic way for
 *                         a GUI to talk to the agent without a terminal
 *   cell_free()         — release strings returned by cell_run_oneshot()
 *
 * Not exposed here (they need the HTTP transport): structured event streams,
 * remote approvals and session enumeration are served by `cell --serve` —
 * see docs/RESTful.md — which a desktop front-end can drive in a second
 * process, or reach through the same binary via a loopback connection.
 */
#ifndef CELL_H
#define CELL_H

/* ------------------------------------------------------------------------- */
/*  Export/import decoration — define CELL_USE_SHARED when linking against    */
/*  the shared library (it is set automatically by the exported CMake target  */
/*  cell::shared). Define CELL_STATIC when linking the static library.        */
/* ------------------------------------------------------------------------- */
#if !defined(CELL_API)
#if defined(_WIN32) || defined(__CYGWIN__)
#if defined(CELL_USE_SHARED)
#define CELL_API __declspec(dllimport)
#else
#define CELL_API
#endif
#else
#if defined(CELL_USE_SHARED)
#define CELL_API __attribute__((visibility("default")))
#else
#define CELL_API
#endif
#endif
#endif

#if defined(__cplusplus)
extern "C" {
#endif

/* Build identity string; never NULL. */
CELL_API const char *cell_version(void);

/* Run the built-in self-test suite.
 * Returns 0 when every test passed, non-zero otherwise (2 = busy). */
CELL_API int cell_selftest(void);

/* Run the full command-line interface in-process.
 *
 * Same code path as the `cell` executable: interactive REPL when stdin is a
 * terminal, one-shot stdin->reply otherwise. Blocks until the session ends.
 * Returns the process exit code the standalone binary would have returned
 * (0 = clean session, 1 = error, 2 = rejected because another entry point is
 * already running). Unlike the executable, bad argument lists are reported as
 * a return value instead of terminating the host process.
 *
 * Side effects on the host process: installs/replaces signal handlers and
 * console modes, reads/writes the config root under the current working
 * directory (./.cell by default) and runs the sandboxed exec tool when the
 * model asks for it. Prefer calling it right before the host wants to become
 * the agent, or use cell_run_oneshot() for single turns. */
CELL_API int cell_main(int argc, const char *argv[]);

/* One user message -> one complete agent turn -> captured output.
 *
 * message : UTF-8 text; NULL is rejected.
 * reply   : receives a malloc'd, NUL-terminated UTF-8 string combining the
 *           CLI's stdout and stderr for this turn. On return codes 0 and 1 it
 *           is always a valid allocation (possibly empty); on 2/3 it may stay
 *           NULL. Release it with cell_free() — never with free().
 *
 * Return codes:
 *   0  turn completed
 *   1  the agent/CLI reported an error (message is in *reply)
 *   2  rejected: NULL arguments, or another entry point is already running
 *   3  internal I/O failure (temp files, stdout capture)
 *
 * Behaviour notes:
 *   - Blocks until the turn ends. Never opens an interactive prompt.
 *   - stdin/stdout/stderr are redirected to scratch files for the duration of
 *     the call; do not write to stdio from other threads while it runs.
 *   - The agent operates on the process's *current working directory*; call
 *     from the directory that should act as the workspace.
 *   - Tool calls that require interactive approval (Policy::Ask, e.g. exec)
 *     are refused, because the captured stdin is not a terminal — the sandbox
 *     fails closed. Enable autoallow (full-access only) or drive the CLI
 *     interactively via cell_main() when approvals are needed. */
CELL_API int cell_run_oneshot(const char *message, char **reply);

/* Free a string returned through cell_run_oneshot(). Uses the same C runtime
 * the library was built with, so it is safe across DLL boundaries. */
CELL_API void cell_free(void *ptr);

#if defined(__cplusplus)
} /* extern "C" */
#endif

#endif /* CELL_H */
