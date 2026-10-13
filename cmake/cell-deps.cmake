# =============================================================================
#  cell — dependency resolution
#
#  Shared by the main build (CMakeLists.txt) and by the installed package
#  config (cell-config.cmake), so a find_package(cell) consumer resolves the
#  exact same targets a static link needs. Every fallback branch creates the
#  *canonical* imported-target name (CURL::libcurl, sodium::sodium,
#  nlohmann_json::nlohmann_json), which keeps the recorded link interfaces
#  resolvable no matter which discovery path produced them.
#
#  Result (set in the caller scope):
#    CELL_CURL / CELL_SODIUM / CELL_JSON — targets to link
# =============================================================================

find_package(Threads QUIET)
if(NOT Threads_FOUND AND NOT CELL_DEPS_QUIET)
    message(FATAL_ERROR "Threads (pthreads) was not found; cell.cpp needs a threading runtime.")
endif()

# ---- libcurl ----------------------------------------------------------------
find_package(CURL QUIET)
if(TARGET CURL::libcurl)
    set(CELL_CURL CURL::libcurl)
elseif(CURL_INCLUDE_DIRS AND CURL_LIBRARIES)
    # old find modules / config packages that only set variables
    if(NOT TARGET CURL::libcurl)
        add_library(CURL::libcurl INTERFACE IMPORTED)
        set_target_properties(CURL::libcurl PROPERTIES
            INTERFACE_INCLUDE_DIRECTORIES "${CURL_INCLUDE_DIRS}"
            INTERFACE_LINK_LIBRARIES "${CURL_LIBRARIES}")
    endif()
    set(CELL_CURL CURL::libcurl)
else()
    set(CELL_CURL "")
    if(NOT CELL_DEPS_QUIET)
        message(FATAL_ERROR
            "libcurl was not found. Install it and re-run cmake:\n"
            "  * vcpkg   : vcpkg install curl        (or use the bundled vcpkg.json manifest)\n"
            "  * MSYS2   : pacman -S mingw-w64-ucrt-x86_64-curl\n"
            "  * Debian  : apt install libcurl4-openssl-dev\n"
            "  * Fedora  : dnf install libcurl-devel\n"
            "  * macOS   : brew install curl\n"
            "  * manual  : -DCURL_INCLUDE_DIR=<dir> -DCURL_LIBRARY=<file>")
    endif()
endif()

# ---- libsodium (config package -> vcpkg -> pkg-config -> manual) ------------
if(NOT TARGET sodium::sodium)
    find_package(sodium CONFIG QUIET)             # upstream libsodium config
endif()
if(NOT TARGET sodium::sodium)
    find_package(unofficial-sodium CONFIG QUIET)  # vcpkg port name
    if(TARGET unofficial-sodium::sodium AND NOT TARGET sodium::sodium)
        add_library(sodium::sodium ALIAS unofficial-sodium::sodium)
    endif()
endif()
if(NOT TARGET sodium::sodium)
    find_package(PkgConfig QUIET)
    if(PkgConfig_FOUND)
        pkg_check_modules(CELL_SODIUM_PC QUIET IMPORTED_TARGET libsodium)
        if(TARGET PkgConfig::CELL_SODIUM_PC)
            add_library(sodium::sodium ALIAS PkgConfig::CELL_SODIUM_PC)
        endif()
    endif()
endif()
if(NOT TARGET sodium::sodium)
    find_path(CELL_SODIUM_INCLUDE_DIR sodium.h)
    find_library(CELL_SODIUM_LIBRARY NAMES sodium libsodium)
    if(CELL_SODIUM_INCLUDE_DIR AND CELL_SODIUM_LIBRARY)
        add_library(sodium::sodium UNKNOWN IMPORTED)
        set_target_properties(sodium::sodium PROPERTIES
            IMPORTED_LOCATION "${CELL_SODIUM_LIBRARY}"
            INTERFACE_INCLUDE_DIRECTORIES "${CELL_SODIUM_INCLUDE_DIR}")
    endif()
endif()
if(TARGET sodium::sodium)
    set(CELL_SODIUM sodium::sodium)
else()
    set(CELL_SODIUM "")
    if(NOT CELL_DEPS_QUIET)
        message(FATAL_ERROR
            "libsodium was not found. Install it and re-run cmake:\n"
            "  * vcpkg   : vcpkg install libsodium    (or use the bundled vcpkg.json manifest)\n"
            "  * MSYS2   : pacman -S mingw-w64-ucrt-x86_64-libsodium\n"
            "  * Debian  : apt install libsodium-dev\n"
            "  * Fedora  : dnf install libsodium-devel\n"
            "  * macOS   : brew install libsodium")
    endif()
endif()

# ---- nlohmann/json (header-only) --------------------------------------------
if(NOT TARGET nlohmann_json::nlohmann_json)
    find_package(nlohmann_json CONFIG QUIET)
endif()
if(NOT TARGET nlohmann_json::nlohmann_json)
    find_path(CELL_JSON_INCLUDE_DIR nlohmann/json.hpp)
    if(CELL_JSON_INCLUDE_DIR)
        add_library(nlohmann_json::nlohmann_json INTERFACE IMPORTED)
        set_target_properties(nlohmann_json::nlohmann_json PROPERTIES
            INTERFACE_INCLUDE_DIRECTORIES "${CELL_JSON_INCLUDE_DIR}")
    endif()
endif()
# a FetchContent fallback for the header-only json library is handled by the
# main build (CMakeLists.txt); the package config only needs a resolvable
# target, so a missing installation there is reported as a hard error
if(TARGET nlohmann_json::nlohmann_json)
    set(CELL_JSON nlohmann_json::nlohmann_json)
else()
    set(CELL_JSON "")
    if(NOT CELL_DEPS_QUIET)
        message(FATAL_ERROR
            "nlohmann/json was not found. Install it:\n"
            "  vcpkg: vcpkg install nlohmann-json | MSYS2: pacman -S mingw-w64-ucrt-x86_64-nlohmann-json\n"
            "  Debian: apt install nlohmann-json3-dev | macOS: brew install nlohmann-json")
    endif()
endif()
