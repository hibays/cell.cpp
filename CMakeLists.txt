# =============================================================================
#  cell.cpp — CMake build
#
#  Design goals (in order):
#    1. Multi-platform   — Windows (MSVC / MinGW / Clang), Linux, macOS
#    2. Multi-toolchain  — GCC, Clang, MSVC, AppleClang, MinGW; any generator
#    3. CI-first         — non-interactive, hermetic options, ctest wired in
#    4. Quick to adopt   — one configure+build command per platform; a vcpkg
#                          manifest and CMakePresets.json ship in the repo
#    5. Robust           — capability probes instead of version guessing,
#                          clear failure messages, dependency fallback chains
#
#  Targets:
#    cell          (CLI executable,      CELL_BUILD_CLI=ON,    default ON)
#    cell::shared  (DLL / .so / .dylib,  CELL_BUILD_SHARED=ON, default ON)
#    cell::static  (static library,      CELL_BUILD_STATIC=ON, default OFF)
#    cellui        (WebUI desktop shell, CELL_BUILD_WEBUI=ON,  default ON)
#
#  The single-file contract stays intact: `g++ -std=c++26 -O2 cell.cpp -o cell
#  -lcurl -lsodium` still works with no CMake involved. Everything below is an
#  additive build harness (and the only place that defines CELL_* macros).
# =============================================================================
cmake_minimum_required(VERSION 3.21)

project(cell
    VERSION 0.1.9
    DESCRIPTION "A single-file AI coding agent in modern C++26"
    LANGUAGES C CXX) # C for the vendored WebUI / civetweb sources

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")

# -----------------------------------------------------------------------------
#  Windows resource (brand icon + version stamp)
#
#  Embed the brand mark (cell.ico) and a version resource into the .exe so the
#  binaries carry the cell identity in Explorer and on the taskbar. RC is only
#  meaningful on Windows; the brand assets are shipped in the release package on
#  every platform (see .github/workflows/release.yml).
# -----------------------------------------------------------------------------
if(WIN32)
    enable_language(RC)
    set(CELL_BRAND_DIR "${CMAKE_CURRENT_SOURCE_DIR}/assets/brand")
    configure_file("${CELL_BRAND_DIR}/win/cell.rc.in"
        "${CMAKE_BINARY_DIR}/gen/brand/cell.rc" @ONLY)
    configure_file("${CELL_BRAND_DIR}/win/cellui.rc.in"
        "${CMAKE_BINARY_DIR}/gen/brand/cellui.rc" @ONLY)
endif()

# -----------------------------------------------------------------------------
#  Options
# -----------------------------------------------------------------------------
option(CELL_BUILD_CLI            "Build the cell command-line executable"                    ON)
option(CELL_BUILD_SHARED         "Build cell as a shared library (DLL / .so / .dylib)"       ON)
option(CELL_BUILD_STATIC         "Build cell as a static library"                            OFF)
option(CELL_BUILD_WEBUI          "Build cellui (WebUI desktop shell, single binary)"         ON)
option(CELL_EMBED_WEBUI          "Embed the built front-end (webui/frontend/dist) into cellui"     ON)
option(CELL_WEBUI_LOG            "Verbose WebUI core logging (stderr) — debugging aid"       OFF)
option(CELL_BUILD_TESTS          "Register ctest tests (self-test + embedding smoke test)"   ON)
option(CELL_INSTALL              "Generate install rules and a CMake package (find_package)" ON)
option(CELL_FETCH_DEPS           "Allow fetching header-only deps when not installed"        ON)
option(CELL_ENABLE_WARNINGS      "Enable the recommended warning set"                        ON)
option(CELL_WARNINGS_AS_ERRORS   "Promote warnings to errors (recommended in CI)"            OFF)
option(CELL_ENABLE_LTO           "Enable interprocedural optimization in Release"            OFF)
option(CELL_ENABLE_ASAN          "Build with Address/UndefinedBehavior sanitizers"           OFF)
option(CELL_TOOLCHAIN_CHECKS     "Probe the toolchain and fail fast when features are missing" ON)
option(CELL_MINGW_STATIC_RUNTIME "MinGW: link libgcc/libstdc++ statically into the binaries" ON)

set(CELL_CXX_STANDARD 26 CACHE STRING "C++ standard level (26 recommended; 23 on exotic toolchains)")

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
    set_property(CACHE CMAKE_BUILD_TYPE PROPERTY STRINGS Debug Release RelWithDebInfo MinSizeRel)
endif()

# -----------------------------------------------------------------------------
#  C++ standard
#
#  Three paths, all ending in the same compiler flag:
#    * MSVC  — always inject `/std:c++latest` directly: CMake's MSVC mapping for
#              CXX_STANDARD 26 depends on the CMake version, and a value CMake
#              cannot map makes every try_compile fail ("requires the language
#              dialect CXX26").
#    * CMake >= 3.30 — knows "26" natively for GCC/Clang.
#    * older CMake  — the flag is injected directly.
#  The capability probe below then verifies the flag for real.
# -----------------------------------------------------------------------------
if(MSVC)
    set(CELL_CXX_FLAG "/std:c++latest") # MSVC spells C++26 "latest"
else()
    set(CELL_CXX_FLAG "-std=c++${CELL_CXX_STANDARD}")
endif()

if(MSVC)
    string(APPEND CMAKE_CXX_FLAGS " ${CELL_CXX_FLAG}")
    # make the optimisation level visible in the configure log — the MSVC CI job
    # spends ~15 min in the self-test (vs ~25 s with MinGW) and "is Release even
    # on?" is the first question that comes up every time.
    message(STATUS "MSVC base flags   : ${CMAKE_CXX_FLAGS}")
    message(STATUS "MSVC Release flags: ${CMAKE_CXX_FLAGS_RELEASE}")
elseif(CMAKE_VERSION VERSION_GREATER_EQUAL 3.30)
    set(CMAKE_CXX_STANDARD ${CELL_CXX_STANDARD})
    set(CMAKE_CXX_STANDARD_REQUIRED ON)
    set(CMAKE_CXX_EXTENSIONS OFF)
else()
    message(STATUS "CMake ${CMAKE_VERSION} predates C++${CELL_CXX_STANDARD} support; injecting '${CELL_CXX_FLAG}' directly")
    string(APPEND CMAKE_CXX_FLAGS " ${CELL_CXX_FLAG}")
endif()

# -----------------------------------------------------------------------------
#  Toolchain capability probe
#
#  The authoritative check is a compile test of the exact standard-library
#  features cell.cpp uses — version numbers are only used to produce friendlier
#  messages beforehand (no false negatives from version heuristics).
# -----------------------------------------------------------------------------
if(CELL_TOOLCHAIN_CHECKS)
    if(MSVC AND MSVC_VERSION LESS 1940)
        message(WARNING
            "MSVC ${MSVC_VERSION} detected; cell.cpp needs the C++23/26 library set of "
            "Visual Studio 2022 17.10+ (recommended: 17.12+). The feature probe below is authoritative.")
    elseif(GNU AND CMAKE_CXX_COMPILER_VERSION VERSION_LESS 14)
        message(WARNING
            "GCC ${CMAKE_CXX_COMPILER_VERSION} detected; cell.cpp needs <format>/"
            "<expected> from GCC 14+ (recommended: 15+). The feature probe below is authoritative.")
    elseif(Clang AND NOT AppleClang AND CMAKE_CXX_COMPILER_VERSION VERSION_LESS 17)
        message(WARNING
            "Clang ${CMAKE_CXX_COMPILER_VERSION} detected; cell.cpp needs Clang 17+ with a "
            "recent libstdc++/libc++ (recommended: 19+). The feature probe below is authoritative.")
    elseif(AppleClang AND CMAKE_CXX_COMPILER_VERSION VERSION_LESS 16)
        message(WARNING
            "AppleClang ${CMAKE_CXX_COMPILER_VERSION} detected; cell.cpp needs Xcode 16.3+ "
            "(libc++ with <format>/<expected>). The feature probe below is authoritative.")
    endif()

    include(CheckCXXSourceCompiles)
    set(_cell_saved_required_flags "${CMAKE_REQUIRED_FLAGS}")
    set(CMAKE_REQUIRED_FLAGS "${CMAKE_REQUIRED_FLAGS} ${CELL_CXX_FLAG}")

    # One probe per feature, so a failure names the exact header a toolchain is
    # missing instead of a combined "something in there" error.
    set(_cell_probe_format "
#include <format>
#include <string>
int main() { auto s = std::format(\"{}\", 1); (void)s; return 0; }")
    set(_cell_probe_expected "
#include <expected>
#include <string>
int main() { std::expected<int, std::string> e = 1; return e.has_value() ? 0 : 1; }")
    set(_cell_probe_span_concepts "
#include <span>
#include <concepts>
#include <vector>
int main() { std::vector<int> v{1, 2, 3}; std::span<const int> s{v}; return s.size() == 3 ? 0 : 1; }")
    set(_cell_probe_move_only_function "
#include <functional>
#include <span>
int main() {
    std::move_only_function<void(std::span<const char>)> fn = [](std::span<const char>) {};
    (void)fn;
    return 0;
    }")

    set(_cell_probes format expected span_concepts)
    set(CELL_MISSING_FEATURES "")
    set(CELL_NEEDS_SIZED_DEALLOC OFF)
    foreach(_cell_p IN LISTS _cell_probes)
        string(TOUPPER "${_cell_p}" _cell_pu)
        set(_cell_var CELL_HAVE_${_cell_pu})
        check_cxx_source_compiles("${_cell_probe_${_cell_p}}" ${_cell_var})
        # libstdc++ gates parts of the library on __cpp_sized_deallocation, which
        # GCC defines by default but Clang does not — retry with the flag and keep it.
        if(NOT ${_cell_var} AND CMAKE_CXX_COMPILER_ID MATCHES "Clang" AND NOT CELL_NEEDS_SIZED_DEALLOC)
            string(APPEND CMAKE_REQUIRED_FLAGS " -fsized-deallocation")
            check_cxx_source_compiles("${_cell_probe_${_cell_p}}" ${_cell_var}_SD)
            if(${_cell_var}_SD)
                set(${_cell_var} TRUE)
                set(CELL_NEEDS_SIZED_DEALLOC ON)
                string(APPEND CMAKE_CXX_FLAGS " -fsized-deallocation")
                message(STATUS "Clang needs -fsized-deallocation for this libstdc++ feature; adding it")
            endif()
            set(CMAKE_REQUIRED_FLAGS "${_cell_saved_required_flags} ${CELL_CXX_FLAG}")
        endif()
        if(NOT ${_cell_var})
            list(APPEND CELL_MISSING_FEATURES "${_cell_p}")
        endif()
    endforeach()
    set(CMAKE_REQUIRED_FLAGS "${_cell_saved_required_flags}")

    if(CELL_MISSING_FEATURES)
        # Re-run the first missing feature through try_compile so the real
        # compiler diagnostics end up in the configure log.
        list(GET CELL_MISSING_FEATURES 0 _cell_first)
        file(WRITE "${CMAKE_BINARY_DIR}/CMakeFiles/cell-toolprobe-${_cell_first}/probe.cpp"
            "${_cell_probe_${_cell_first}}")
        try_compile(_cell_diag "${CMAKE_BINARY_DIR}/CMakeFiles/cell-toolprobe-${_cell_first}"
            SOURCES "${CMAKE_BINARY_DIR}/CMakeFiles/cell-toolprobe-${_cell_first}/probe.cpp"
            COMPILE_DEFINITIONS "${CELL_CXX_FLAG}"
            OUTPUT_VARIABLE _cell_diag_out)
        message(STATUS "toolchain probe — missing: ${CELL_MISSING_FEATURES}")
        string(REGEX REPLACE "\n" "\n  " _cell_diag_indented "${_cell_diag_out}")
        message(STATUS "compiler output for '${_cell_first}':\n  ${_cell_diag_indented}")
        message(FATAL_ERROR
            "The toolchain cannot compile the C++${CELL_CXX_STANDARD} standard library features "
            "cell.cpp requires (missing: ${CELL_MISSING_FEATURES}).\n"
            "  (<generator> and std::move_only_function are optional: cell.cpp ships portable\n"
            "   fallbacks for libc++, which still lacks both.)\n"
            "  Compiler: ${CMAKE_CXX_COMPILER_ID} ${CMAKE_CXX_COMPILER_VERSION}\n"
            "  Flag tried: ${CELL_CXX_FLAG}\n"
            "Minimum known-good toolchains://n"
            "  * GCC 14+ (recommended 15+)          e.g. MSYS2 UCRT64, Ubuntu gcc-14\n"
            "  * Clang 17+ with libstdc++ 14+       add -fsized-deallocation (libc++: 19+ for std::generator)\n"
            "  * MSVC 19.40+ (VS 2022 17.10+)       /std:c++latest\n"
            "  * AppleClang 16.3+ (Xcode 16.3+)     libc++\n"
            "Set -DCELL_TOOLCHAIN_CHECKS=OFF to skip this probe and try anyway.")
    endif()
endif()

# -----------------------------------------------------------------------------
#  Compiler launcher (ccache / sccache) — keeps iterative and CI builds fast
# -----------------------------------------------------------------------------
if(NOT CMAKE_CXX_COMPILER_LAUNCHER)
    find_program(CELL_CCACHE ccache)
    find_program(CELL_SCCACHE sccache)
    if(CELL_CCACHE)
        set(CMAKE_CXX_COMPILER_LAUNCHER "${CELL_CCACHE}")
        message(STATUS "Using ccache: ${CELL_CCACHE}")
    elseif(CELL_SCCACHE)
        set(CMAKE_CXX_COMPILER_LAUNCHER "${CELL_SCCACHE}")
        message(STATUS "Using sccache: ${CELL_SCCACHE}")
    endif()
endif()

# -----------------------------------------------------------------------------
#  Dependencies: libcurl, libsodium, nlohmann/json (header-only)
# -----------------------------------------------------------------------------
find_package(Threads REQUIRED)

# keep every artifact in one place: bin/ (runtime) and lib/ (link-time), which
# also means Windows finds cell.dll next to the test binaries with no PATH work.
# (must be set before any target is created so the targets inherit them)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/lib")
foreach(_cfg IN ITEMS DEBUG RELEASE RELWITHDEBINFO MINSIZEREL)
    set(CMAKE_RUNTIME_OUTPUT_DIRECTORY_${_cfg} "${CMAKE_BINARY_DIR}/bin")
    set(CMAKE_LIBRARY_OUTPUT_DIRECTORY_${_cfg} "${CMAKE_BINARY_DIR}/bin")
    set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY_${_cfg} "${CMAKE_BINARY_DIR}/lib")
endforeach()

# ---- libcurl / libsodium / nlohmann-json ------------------------------------
# Resolution logic lives in cmake/cell-deps.cmake because the installed package
# config (cell-config.cmake) includes the very same module: a consumer of the
# static library resolves identical targets.
include(${CMAKE_CURRENT_LIST_DIR}/cmake/cell-deps.cmake)

# the main build may additionally fetch the header-only json library
if(NOT CELL_JSON AND CELL_FETCH_DEPS)
    include(FetchContent)
    message(STATUS "nlohmann/json not installed; fetching v3.12.0 (header-only)")
    if(CMAKE_VERSION VERSION_GREATER_EQUAL 3.24)
        FetchContent_Declare(nlohmann_json
            URL https://github.com/nlohmann/json/releases/download/v3.12.0/json.tar.xz
            DOWNLOAD_EXTRACT_TIMESTAMP TRUE
            FIND_PACKAGE_ARGS NAMES nlohmann_json)
    else()
        FetchContent_Declare(nlohmann_json
            URL https://github.com/nlohmann/json/releases/download/v3.12.0/json.tar.xz)
    endif()
    FetchContent_MakeAvailable(nlohmann_json)
    if(NOT TARGET nlohmann_json::nlohmann_json)
        message(FATAL_ERROR "nlohmann/json fetch succeeded but the expected target is missing")
    endif()
    set(CELL_JSON nlohmann_json::nlohmann_json)
endif()

foreach(_dep IN ITEMS CELL_CURL CELL_SODIUM CELL_JSON)
    if(NOT ${_dep})
        message(FATAL_ERROR "${_dep} could not be resolved; see the messages above for install hints")
    endif()
endforeach()

# -----------------------------------------------------------------------------
#  Sanitizers (development / CI hardening)
#
#  Defined before any target so the directory-scoped compile/link options apply.
#  Needs a toolchain that ships the sanitizer runtime: GCC/Clang on Linux and
#  macOS, MSVC (/fsanitize=address) — some MinGW distributions (e.g. MSYS2
#  UCRT64) do not ship libasan, so the option is a no-op-to-loud-error there.
# -----------------------------------------------------------------------------
if(CELL_ENABLE_ASAN)
    if(MSVC)
        set(_cell_asan_flags "/fsanitize=address")
        set(_cell_asan_link_flags "/INCREMENTAL:NO")
    else()
        # a CMake list, so each flag reaches the compiler as its own argument
        set(_cell_asan_flags "-fsanitize=address,undefined" "-fno-omit-frame-pointer" "-g")
        set(_cell_asan_link_flags "-fsanitize=address,undefined")
    endif()

    # Probe the *link* step: a toolchain without the sanitizer runtime would
    # otherwise fail later with hundreds of undefined __asan_* references.
    include(CheckCXXSourceCompiles)
    set(_cell_saved_required_flags "${CMAKE_REQUIRED_FLAGS}")
    string(REPLACE ";" " " _cell_asan_flags_probe "${_cell_asan_flags}")
    set(CMAKE_REQUIRED_FLAGS "${CMAKE_REQUIRED_FLAGS} ${_cell_asan_flags_probe}")
    check_cxx_source_compiles("int main() { return 0; }" CELL_TOOLCHAIN_SUPPORTS_SANITIZERS)
    set(CMAKE_REQUIRED_FLAGS "${_cell_saved_required_flags}")

    if(NOT CELL_TOOLCHAIN_SUPPORTS_SANITIZERS)
        message(FATAL_ERROR
            "CELL_ENABLE_ASAN=ON, but this toolchain cannot link the sanitizer runtime.\n"
            "  Compiler: ${CMAKE_CXX_COMPILER_ID} ${CMAKE_CXX_COMPILER_VERSION}\n"
            "  Flags tried: ${_cell_asan_flags_probe}\n"
            "GCC/Clang on Linux and macOS ship libasan/libubsan; MSVC supports "
            "/fsanitize=address; some MinGW distributions (e.g. MSYS2 UCRT64) do not "
            "ship the sanitizer runtime at all.")
    endif()

    add_compile_options(${_cell_asan_flags})
    add_link_options(${_cell_asan_link_flags})
    message(STATUS "Sanitizers enabled (ASan + UBSan)")
endif()

# -----------------------------------------------------------------------------
#  Shared target configuration
# -----------------------------------------------------------------------------
function(cell_configure_target target)
    # CXX only, on purpose: target_compile_definitions also feeds the resource
    # compiler, and the embedded quotes are fatal there. windres preprocesses
    # through /bin/sh, which aborts on CMake's escaped -DCELL_VERSION=\"x\"
    # ("unexpected EOF while looking for matching quote"). Guarding by language
    # keeps the Windows resource files (brand icon + version stamp) compiling.
    target_compile_definitions(${target} PRIVATE
        "$<$<COMPILE_LANGUAGE:CXX>:CELL_VERSION=\"${CELL_VERSION_STRING}\">")

    if(WIN32)
        # the built-in HTTP server of `cell --serve` uses Winsock 2
        target_link_libraries(${target} PRIVATE ws2_32)
    endif()

    # ---- dependency linkage -------------------------------------------------
    # MinGW + CELL_STATIC_DEPS: Release links `-static` with the pkg-config
    # dependency set (curl, sodium and curl's transitive static deps) — that is
    # what makes the shipped binaries portable single files. The shared curl
    # target is deliberately NOT linked there: its imported location points at
    # the import library, which `-static` cannot override.
    if(MINGW AND CELL_STATIC_DEPS AND CELL_MINGW_STATIC_LINK)
        # the curl/sodium headers must drop their dllimport decoration or the
        # objects reference __imp_* symbols the static archives do not define
        target_compile_definitions(${target} PRIVATE CURL_STATICLIB SODIUM_STATIC)
        target_link_options(${target} PRIVATE $<$<NOT:$<CONFIG:Debug>>:-static>)
        target_link_libraries(${target} PRIVATE
            $<$<CONFIG:Debug>:${CELL_CURL}>
            $<$<CONFIG:Debug>:${CELL_SODIUM}>
            $<$<NOT:$<CONFIG:Debug>>:${CELL_MINGW_STATIC_LINK}>)
    else()
        target_link_libraries(${target} PRIVATE ${CELL_CURL} ${CELL_SODIUM})
    endif()
    target_link_libraries(${target} PRIVATE ${CELL_JSON} Threads::Threads)

    if(CELL_ENABLE_WARNINGS)
        if(MSVC)
            target_compile_options(${target} PRIVATE /W4 /permissive-)
        else()
            target_compile_options(${target} PRIVATE -Wall -Wextra)
        endif()
    endif()
    if(CELL_WARNINGS_AS_ERRORS)
        if(MSVC)
            target_compile_options(${target} PRIVATE /WX)
        else()
            target_compile_options(${target} PRIVATE -Werror)
        endif()
    endif()

    if(MINGW AND CELL_MINGW_STATIC_RUNTIME AND NOT (CELL_STATIC_DEPS AND CELL_MINGW_STATIC_LINK))
        # Ship a self-contained DLL/exe: no libstdc++-6.dll / libgcc_s_*.dll to
        # copy next to the binary. (In the CELL_STATIC_DEPS path `-static`
        # already covers these, so the flags are only needed here.)
        # Debug builds are excluded: the MinGW linker fails silently when a
        # large debug object (tens of MB) is combined with libstdc++.a, and a
        # development build wants the dynamic runtime anyway.
        target_link_options(${target} PRIVATE
            $<$<NOT:$<CONFIG:Debug>>:-static-libgcc>
            $<$<NOT:$<CONFIG:Debug>>:-static-libstdc++>)
    endif()

    # cellui compiles cell.cpp in a TU that already includes the WebUI headers;
    # that combination makes GCC's -Wsubobject-linkage fire on pre-existing
    # internal-linkage lambdas. It is cosmetic (the CLI/shared TUs are clean).
    if(CELL_BUILD_WEBUI AND NOT MSVC)
        target_compile_options(${target} PRIVATE -Wno-subobject-linkage)
    endif()

    if(CELL_ENABLE_LTO)
        set_target_properties(${target} PROPERTIES INTERPROCEDURAL_OPTIMIZATION_RELEASE TRUE)
    endif()
endfunction()

set(CELL_VERSION_STRING "${PROJECT_VERSION}" CACHE STRING
    "Version string compiled into cell_version(); CI may inject a tag or commit")

# ---- shared library (DLL / .so / .dylib) ------------------------------------
if(CELL_BUILD_SHARED)
    add_library(cell_shared SHARED cell.cpp)
    add_library(cell::shared ALIAS cell_shared)
    target_compile_definitions(cell_shared PRIVATE CELL_BUILD_SHARED CELL_NO_MAIN)
    # consumers import from the shared library (cell.h picks __declspec(dllimport))
    target_compile_definitions(cell_shared INTERFACE CELL_USE_SHARED)
    target_include_directories(cell_shared PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<INSTALL_INTERFACE:include>)
    set_target_properties(cell_shared PROPERTIES
        OUTPUT_NAME cell
        EXPORT_NAME shared         # find_package consumers link cell::shared
        POSITION_INDEPENDENT_CODE ON
        CXX_VISIBILITY_PRESET hidden
        VISIBILITY_INLINES_HIDDEN ON
        SOVERSION ${PROJECT_VERSION_MAJOR}
        VERSION ${PROJECT_VERSION})
    if(WIN32)
        # MinGW would otherwise emit libcell.dll; keep the name identical to the
        # MSVC output so desktop integrators see one convention: cell.dll
        set_target_properties(cell_shared PROPERTIES PREFIX "")
    endif()
    cell_configure_target(cell_shared)
endif()

# ---- static library ---------------------------------------------------------
if(CELL_BUILD_STATIC)
    add_library(cell_static STATIC cell.cpp)
    add_library(cell::static ALIAS cell_static)
    target_compile_definitions(cell_static PRIVATE CELL_NO_MAIN)
    target_include_directories(cell_static PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<INSTALL_INTERFACE:include>)
    if(MSVC)
        # cell.lib is already the import library of the DLL; keep them apart
        set_target_properties(cell_static PROPERTIES OUTPUT_NAME cell-static)
    else()
        set_target_properties(cell_static PROPERTIES OUTPUT_NAME cell)
    endif()
    set_target_properties(cell_static PROPERTIES
        EXPORT_NAME static         # find_package consumers link cell::static
        POSITION_INDEPENDENT_CODE ON)
    cell_configure_target(cell_static)
    # note: a STATIC library already records its PRIVATE link dependencies as
    # $<LINK_ONLY:...> in its interface — nothing extra to add here
endif()

# ---- CLI executable ---------------------------------------------------------
if(CELL_BUILD_CLI)
    add_executable(cell_cli cell.cpp)
    add_executable(cell::cli ALIAS cell_cli)
    set_target_properties(cell_cli PROPERTIES OUTPUT_NAME cell)
    if(WIN32)
        target_sources(cell_cli PRIVATE "${CMAKE_BINARY_DIR}/gen/brand/cell.rc")
    endif()
    cell_configure_target(cell_cli)
endif()

# ---- vendored WebUI (the desktop shell driver) ------------------------------
# webui/third_party/webui carries the WebUI sources (webui.c + civetweb + the
# WebView2/WKWebView backends). On Windows the WebView2 loader is linked
# statically (webui/third_party/webui/lib/WebView2LoaderStatic.lib), so the shell
# binary needs no runtime DLLs next to it.
if(CELL_BUILD_WEBUI)
    set(WEBUI_DIR ${CMAKE_CURRENT_SOURCE_DIR}/webui/third_party/webui)
    if(NOT EXISTS ${WEBUI_DIR}/include/webui.h)
        message(FATAL_ERROR "webui/third_party/webui is missing (expected ${WEBUI_DIR}/include/webui.h)")
    endif()

    add_library(webui STATIC
        ${WEBUI_DIR}/src/webui.c
        ${WEBUI_DIR}/src/civetweb/civetweb.c)
    # Static-link the WebView2 loader when we can. On GNU toolchains the MSVC
    # objects need LLD (bfd cannot read them) plus a handful of MSVC runtime
    # symbols, both handled here.
    set(CELL_WEBVIEW_STATIC OFF)
    if(WIN32)
        target_sources(webui PRIVATE ${WEBUI_DIR}/src/webview/win32_wv2.cpp)
    elseif(APPLE)
        enable_language(OBJC)
        target_sources(webui PRIVATE ${WEBUI_DIR}/src/webview/wkwebview.m)
        find_library(COCOA_FRAMEWORK Cocoa REQUIRED)
        find_library(WEBKIT_FRAMEWORK WebKit REQUIRED)
        target_link_libraries(webui PUBLIC ${COCOA_FRAMEWORK} ${WEBKIT_FRAMEWORK})
    endif()
    target_include_directories(webui PUBLIC ${WEBUI_DIR}/include)
    target_include_directories(webui PRIVATE
        ${WEBUI_DIR}/src
        ${WEBUI_DIR}/src/civetweb
        ${WEBUI_DIR}/src/webview
        ${WEBUI_DIR}/bridge)
    # compile-time behaviour of the vendored sources — never leak into consumers
    target_compile_definitions(webui PRIVATE NO_CACHING NO_CGI USE_WEBSOCKET NO_SSL)
    if(CELL_WEBUI_LOG)
        target_compile_definitions(webui PRIVATE WEBUI_LOG)
    endif()
    if(WIN32)
        target_link_libraries(webui PUBLIC ws2_32 user32 shell32 ole32 uuid oleaut32 comdlg32 advapi32)
        # static WebView2 loader (the runtime itself is provided by the OS)
        if(EXISTS ${WEBUI_DIR}/lib/WebView2LoaderStatic.lib)
            if(MSVC)
                target_link_libraries(webui PRIVATE ${WEBUI_DIR}/lib/WebView2LoaderStatic.lib)
                # Without this the backend tries LoadLibrary("WebView2Loader.dll")
                # and silently gives up, so webui_show() would always fail.
                target_compile_definitions(webui PUBLIC WEBUI_WEBVIEW_STATIC=1)
                set(CELL_WEBVIEW_STATIC ON)
            else()
                # GNU ld (bfd) aborts on the MSVC COFF members; LLD reads them
                # fine once the MSVC runtime symbols are provided.
                include(CheckCXXSourceCompiles)
                set(CMAKE_REQUIRED_FLAGS "-fuse-ld=lld")
                check_cxx_source_compiles("int main(){return 0;}" CELL_HAVE_LLD)
                unset(CMAKE_REQUIRED_FLAGS)
                if(CELL_HAVE_LLD)
                    target_sources(webui PRIVATE ${WEBUI_DIR}/src/webview/wv2_msvc_compat.cpp)
                    target_link_libraries(webui PRIVATE ${WEBUI_DIR}/lib/WebView2LoaderStatic.lib)
                    target_compile_definitions(webui PUBLIC WEBUI_WEBVIEW_STATIC=1)
                    set(CELL_WEBVIEW_STATIC ON)
                else()
                    message(WARNING
                        "LLD not available — cannot static-link the WebView2 loader. "
                        "cellui will look for WebView2Loader.dll at runtime (install mingw-w64-ucrt-x86_64-lld).")
                endif()
            endif()
        else()
            message(WARNING "WebView2LoaderStatic.lib not found in ${WEBUI_DIR}/lib — the shell will need WebView2Loader.dll at runtime")
        endif()
    endif()
    set_target_properties(webui PROPERTIES POSITION_INDEPENDENT_CODE ON)
endif()

# ---- desktop shell (cellui) ---------------------------------------------------
if(CELL_BUILD_WEBUI)
    add_executable(cellui webui/cellui.cpp)
    add_executable(cell::ui ALIAS cellui)
    target_include_directories(cellui PRIVATE ${CMAKE_CURRENT_SOURCE_DIR} ${CMAKE_BINARY_DIR})
    # cell.cpp is linked into the shell; cellui.cpp itself defines CELL_NO_MAIN
    # and owns main(). Dependencies come from cell_configure_target (so the
    # static-dependency switch applies here exactly as it does to the CLI).
    target_link_libraries(cellui PRIVATE webui)
    # the MSVC-built WebView2 loader objects can only be merged by LLD
    if(CELL_WEBVIEW_STATIC AND NOT MSVC)
        target_link_options(cellui PRIVATE -fuse-ld=lld)
    endif()
    if(WIN32)
        target_sources(cellui PRIVATE "${CMAKE_BINARY_DIR}/gen/brand/cellui.rc")
    endif()
    cell_configure_target(cellui)

    # embed the built front-end (webui/frontend/dist/index.html -> cellui_web.h)
    if(CELL_EMBED_WEBUI)
        find_program(CELL_WEB_BUILDER NAMES bun node nodejs)
        if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/webui/frontend/dist/index.html AND CELL_WEB_BUILDER)
            add_custom_command(
                OUTPUT ${CMAKE_BINARY_DIR}/cellui_web.h
                COMMAND ${CELL_WEB_BUILDER} ${CMAKE_CURRENT_SOURCE_DIR}/webui/scripts/embed_webui.mjs ${CMAKE_BINARY_DIR}
                WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
                # Without these, ninja reports "no work to do" after the
                # front-end is rebuilt and the stale payload stays baked in —
                # the binary then ships an old UI with no visible failure.
                DEPENDS
                    ${CMAKE_CURRENT_SOURCE_DIR}/webui/frontend/dist/index.html
                    ${CMAKE_CURRENT_SOURCE_DIR}/webui/scripts/embed_webui.mjs
                COMMENT "embedding the built front-end into the cellui binary"
                VERBATIM)
            add_custom_target(cellui_web DEPENDS ${CMAKE_BINARY_DIR}/cellui_web.h)
            add_dependencies(cellui cellui_web)
            # the generated header defines the payload; this flag is what makes
            # cellui.cpp include it (it cannot self-define before including)
            target_compile_definitions(cellui PRIVATE CELLUI_HAVE_EMBEDDED_WEB=1)
            # remembered for the test registration below: cell.cellui_boot only
            # gates the embedded SPA when this build was configured to embed it
            # (CI's plain linux-gcc job has no dist and must stay green)
            set(CELLUI_EMBEDDED_BUILD TRUE)
        else()
            message(STATUS "cellui: front-end not built (or no node/bun) — the binary falls back to a built-in placeholder page")
        endif()
    endif()
endif()

if(NOT CELL_BUILD_CLI AND NOT CELL_BUILD_SHARED AND NOT CELL_BUILD_STATIC AND NOT CELL_BUILD_WEBUI)
    message(FATAL_ERROR "Nothing to build: enable at least one of CELL_BUILD_CLI / CELL_BUILD_SHARED / CELL_BUILD_STATIC / CELL_BUILD_WEBUI")
endif()

# -----------------------------------------------------------------------------
#  Tests
# -----------------------------------------------------------------------------
if(CELL_BUILD_TESTS)
    enable_testing()

    if(CELL_BUILD_CLI)
        # the built-in self-test suite, run in a scratch working directory so
        # the test never touches the source tree
        add_test(NAME cell.selftest COMMAND cell_cli --selftest)
        set_tests_properties(cell.selftest PROPERTIES
            WORKING_DIRECTORY "${CMAKE_BINARY_DIR}/ctest-selftest"
            TIMEOUT 900)
        file(MAKE_DIRECTORY "${CMAKE_BINARY_DIR}/ctest-selftest")
    endif()

    if(CELL_BUILD_SHARED OR CELL_BUILD_STATIC)
        add_executable(cell_smoke tests/smoke.cpp)
        if(CELL_BUILD_SHARED)
            target_link_libraries(cell_smoke PRIVATE cell_shared)
        else()
            target_link_libraries(cell_smoke PRIVATE cell_static)
        endif()
        add_test(NAME cell.embed_smoke COMMAND cell_smoke)
        set_tests_properties(cell.embed_smoke PROPERTIES
            WORKING_DIRECTORY "${CMAKE_BINARY_DIR}/ctest-smoke"
            TIMEOUT 120)
        file(MAKE_DIRECTORY "${CMAKE_BINARY_DIR}/ctest-smoke")
    endif()

    # Python drives both joint tests below, so look it up once for all of them
    find_package(Python3 COMPONENTS Interpreter)

    # Joint kernel+client e2e: boots `cell --serve` against a mock LLM in a
    # temp CELL_ROOT and drives health -> session -> turn -> transcript, i.e.
    # the exact workflow the front-end runs. Needs any Python 3.
    if(CELL_BUILD_CLI AND Python3_FOUND)
        add_test(NAME cell.e2e_serve
            COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/e2e_serve.py")
        set_tests_properties(cell.e2e_serve PROPERTIES
            ENVIRONMENT "CELL_BIN=$<TARGET_FILE:cell_cli>"
            TIMEOUT 180)

        # Context-window / empty-completion e2e: empty completion, reasoning-only
        # (Ollama delta.reasoning and DeepSeek delta.reasoning_content), content
        # filter, a provider that ignores stream=true, and multi-turn recovery
        # after a failed turn — all against a mock provider on loopback.
        add_test(NAME cell.e2e_context_overflow
            COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/e2e_context_overflow.py")
        set_tests_properties(cell.e2e_context_overflow PROPERTIES
            ENVIRONMENT "CELL_BIN=$<TARGET_FILE:cell_cli>"
            TIMEOUT 180)
    endif()

    # cellui smoke: proves the desktop shell really carries the built front-end
    # (when this build configured the embed step — CELLUI_EXPECT_EMBED) and, on
    # Windows, that its icon resource is loadable by id; under a display it can
    # additionally prove the in-process kernel boots (opt-in via
    # CELLUI_BOOT_TEST=1).
    if(CELL_BUILD_WEBUI AND Python3_FOUND)
        add_test(NAME cell.cellui_boot
            COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/cellui_smoke.py")
        set(_cellui_boot_env "CELLUI_BIN=$<TARGET_FILE:cellui>")
        if(CELLUI_EMBEDDED_BUILD)
            list(APPEND _cellui_boot_env "CELLUI_EXPECT_EMBED=1")
        endif()
        set_tests_properties(cell.cellui_boot PROPERTIES
            ENVIRONMENT "${_cellui_boot_env}"
            TIMEOUT 120)
    endif()

    if(NOT Python3_FOUND)
        message(STATUS "Python3 not found — cell.e2e_serve / cell.cellui_boot skipped")
    endif()
endif()

# -----------------------------------------------------------------------------
#  Install + CMake package export  (find_package(cell) -> cell::shared/static)
# -----------------------------------------------------------------------------
if(CELL_INSTALL)
    include(GNUInstallDirs)
    include(CMakePackageConfigHelpers)

    set(CELL_INSTALL_TARGETS "")
    if(CELL_BUILD_SHARED)
        list(APPEND CELL_INSTALL_TARGETS cell_shared)
    endif()
    if(CELL_BUILD_STATIC)
        list(APPEND CELL_INSTALL_TARGETS cell_static)
    endif()

    if(CELL_INSTALL_TARGETS)
        install(TARGETS ${CELL_INSTALL_TARGETS}
            EXPORT cell-targets
            RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
            LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
            ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
            INCLUDES DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})
    endif()
    if(CELL_BUILD_CLI)
        install(TARGETS cell_cli RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
    endif()
    if(CELL_BUILD_WEBUI)
        install(TARGETS cellui RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
    endif()

    install(FILES include/cell.h DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})

    if(CELL_INSTALL_TARGETS)
        # Dependency block for the package config: a static library propagates
        # its link requirements (as $<LINK_ONLY:...> entries), so consumers must
        # be able to resolve them. The same resolution module the main build
        # uses is installed alongside the config file.
        set(CELL_PACKAGE_DEPENDENCIES "include(CMakeFindDependencyMacro)\n")
        if(CELL_BUILD_STATIC)
            string(APPEND CELL_PACKAGE_DEPENDENCIES
                "find_dependency(Threads)\n"
                "include(\"\${CMAKE_CURRENT_LIST_DIR}/cell-deps.cmake\")\n")
        endif()

        install(EXPORT cell-targets
            NAMESPACE cell::
            FILE cell-targets.cmake
            DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/cell)

        configure_package_config_file(
            cmake/cell-config.cmake.in
            "${CMAKE_CURRENT_BINARY_DIR}/cell-config.cmake"
            INSTALL_DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/cell)
        write_basic_package_version_file(
            "${CMAKE_CURRENT_BINARY_DIR}/cell-config-version.cmake"
            VERSION ${PROJECT_VERSION}
            COMPATIBILITY SameMajorVersion)
        install(FILES
            "${CMAKE_CURRENT_BINARY_DIR}/cell-config.cmake"
            "${CMAKE_CURRENT_BINARY_DIR}/cell-config-version.cmake"
            "${CMAKE_CURRENT_SOURCE_DIR}/cmake/cell-deps.cmake"
            DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/cell)
    endif()
endif()

# -----------------------------------------------------------------------------
#  Summary
# -----------------------------------------------------------------------------
if(CELL_JSON)
    set(_cell_json_state "found")
else()
    set(_cell_json_state "missing")
endif()
message(STATUS "")
message(STATUS "cell ${PROJECT_VERSION} — ${CMAKE_CXX_COMPILER_ID} ${CMAKE_CXX_COMPILER_VERSION}")
message(STATUS "  standard    : ${CELL_CXX_FLAG}")
message(STATUS "  build type  : ${CMAKE_BUILD_TYPE}")
message(STATUS "  targets     : cli=${CELL_BUILD_CLI} shared=${CELL_BUILD_SHARED} static=${CELL_BUILD_STATIC} webui=${CELL_BUILD_WEBUI}")
message(STATUS "  dependencies: curl=${CURL_VERSION_STRING} sodium=${CELL_SODIUM} json=${_cell_json_state}")
message(STATUS "  outputs     : ${CMAKE_BINARY_DIR}/bin  ${CMAKE_BINARY_DIR}/lib")
message(STATUS "")
