/* smoke.cpp — integration smoke test for the cell embedding surface.
 *
 * Linked against the shared library (or the static one) rather than compiling
 * cell.cpp again, so it validates the real consumer path:
 *   1. the header and the library agree on the ABI,
 *   2. the import library / export table actually resolves,
 *   3. the DLL can be loaded (Windows: runtime dependency resolution),
 *   4. the CLI entry point runs end-to-end inside a host process.
 *
 * It deliberately avoids anything that needs a configured provider or network
 * access, so it is safe in CI on every platform.
 */
#include "cell.h"

#include <cstdio>
#include <cstring>

int main()
{
    int failures = 0;

    const char *version = cell_version();
    if (version == nullptr || version[0] == '\0')
    {
        std::fprintf(stderr, "FAIL: cell_version() returned an empty string\n");
        ++failures;
    }
    else
    {
        std::printf("cell_version() = %s\n", version);
    }

    // "cell --help" exercises argument parsing, usage printing and the exit
    // path through the exported entry point. It must not touch the network,
    // the config root, or stdin.
    {
        const char *argv[] = {"cell", "--help", nullptr};
        // --help prints usage and returns 0; anything else means the embedded
        // entry point is broken
        int rc = cell_main(2, argv);
        if (rc != 0)
        {
            std::fprintf(stderr, "FAIL: cell_main(--help) returned %d, expected 0\n", rc);
            ++failures;
        }
    }

    // Bad argument lists must come back as an error code, never as a process
    // exit: this is the guarantee that makes embedding safe.
    {
        const char *argv[] = {"cell", "--model", nullptr};
        int rc = cell_main(2, argv);
        if (rc == 0)
        {
            std::fprintf(stderr, "FAIL: cell_main with a missing argument value returned 0\n");
            ++failures;
        }
    }

    if (failures == 0)
        std::printf("smoke: embedding surface OK\n");
    return failures == 0 ? 0 : 1;
}
