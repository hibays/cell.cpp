#!/usr/bin/env bash
# Local MSVC portability check.
#
# CI's windows-msvc job builds everything with cl.exe, which is the real gate —
# but it needs vcpkg for curl/sodium/json, and on a machine with only the
# Build Tools, vcvars64.bat needs reg.exe (blocked in some sandboxes). So this
# script checks the part that has bitten us before: the **standard-library**
# surface, by extracting the helper straight out of cell.cpp and compiling it
# with cl.exe using INCLUDE/LIB set by hand — no registry, no vcpkg, no deps.
#
# Why it exists: `std::chrono::file_clock::to_sys()` compiles on libstdc++ and
# is *not a member* on MSVC (its file_time_type is measured on the filesystem's
# own clock), which broke the MSVC job in five minutes of work. The helper is
# extracted rather than copied so this can never drift from the real code.
#
# Usage: bash tests/msvc_check.sh [--old]      # --old compiles the pre-fix form
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# vswhere answers in Windows form ("D:////Program Files////..."); everything below
# globs, so normalise to a POSIX path first, and convert back where cl.exe needs it.
to_unix() { echo "$1" | tr '\\' '/' | sed -E 's|^([A-Za-z]):/|/\l\1/|'; }
# ...and back again for cl.exe's own arguments (INCLUDE/LIB and /Fe /Fo)
win_path() { echo "$1" | sed 's|^/c/|C:/|; s|^/d/|D:/|; s|/|\\|g'; }

vswhere="/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe"
[ -x "$vswhere" ] || { echo "skip: vswhere not found (this check is Windows-only)"; exit 0; }
vs_root="$("$vswhere" -latest -products '*' -property installationPath 2>/dev/null | tr -d '\r' | head -1)"
vs_root="$(to_unix "$vs_root")"
[ -n "$vs_root" ] || { echo "skip: no Visual Studio installation found"; exit 0; }

cl_dir="$(ls -d "$vs_root"/VC/Tools/MSVC/*/bin/Hostx64/x64 2>/dev/null | sort -V | tail -1)"
# .../VC/Tools/MSVC/<ver>/bin/Hostx64/x64 -> .../<ver> (three levels up)
inc_root="$(dirname "$(dirname "$(dirname "$cl_dir")")")"
[ -n "$cl_dir" ] || { echo "skip: no MSVC toolset under $vs_root"; exit 0; }

sdk_root="/c/Program Files (x86)/Windows Kits/10"
sdk_ver="$(ls "$sdk_root/Include" 2>/dev/null | sort -V | tail -1)"
[ -n "$sdk_ver" ] || { echo "skip: no Windows SDK found"; exit 0; }


export MSYS2_ARG_CONV_EXCL="*" MSYS_NO_PATHCONV=1
export INCLUDE="$(win_path "$inc_root/include");$(win_path "$sdk_root/Include/$sdk_ver/ucrt");$(win_path "$sdk_root/Include/$sdk_ver/shared");$(win_path "$sdk_root/Include/$sdk_ver/um")"
export LIB="$(win_path "$inc_root/lib/x64");$(win_path "$sdk_root/Lib/$sdk_ver/ucrt/x64");$(win_path "$sdk_root/Lib/$sdk_ver/um/x64")"

out_dir="$repo_root/build/msvc-check"
mkdir -p "$out_dir"
probe="$out_dir/probe.cpp"

# Extract the helper from cell.cpp so the check follows the real code — a copy
# would drift, and a drifted portability check is worse than none.
probe="$out_dir/probe.cpp"
if [ "${1:-}" = "--old" ]; then
  # The historical form, kept only so this script can reproduce what CI saw:
  # MSVC's file_time_type is measured on the filesystem's own clock, which has
  # no to_sys(), and libstdc++ compiles it happily.
  cat > "$probe" <<'EOF'
#include <chrono>
#include <filesystem>
static long long unix_seconds(std::filesystem::file_time_type t)
{
    return (long long)std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::file_clock::to_sys(t).time_since_epoch()).count();
}
int main() { return (int)unix_seconds(std::filesystem::file_time_type::clock::now()); }
EOF
else
  {
    echo '#include <chrono>'
    echo '#include <filesystem>'
    echo '#include <cstdio>'
    awk '/inline long long unix_seconds\(std::filesystem::file_time_type t\)/{f=1} f{print} f&&/^        }$/{exit}' cell.cpp
    cat <<'EOF'
int main()
{
    const long long file = unix_seconds(std::filesystem::file_time_type::clock::now());
    const long long sys = (long long)std::chrono::duration_cast<std::chrono::seconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    std::printf("file_clock=%lld system_now=%lld delta=%lld\n", file, sys, file - sys);
    // within a second of the system clock, either side
    return (file - sys > 2 || sys - file > 2) ? 1 : 0;
}
EOF
  } > "$probe"
fi

probe_win="$(win_path "$probe")"
rm -f "$out_dir/probe.exe"
"$cl_dir/cl.exe" /nologo /std:c++latest /EHsc /O2 /W3 "$probe_win" \
  "/Fe:$(win_path "$out_dir/probe.exe")" "/Fo:$(win_path "$out_dir/")" 2>&1 |
  grep -vE "preview|working draft|provided as-is|Microsoft \(R\)|Copyright|^$|^probe\.cpp$|^msvc-probe" |
  head -8

if [ "${1:-}" = "--old" ]; then
  if [ -f "$out_dir/probe.exe" ]; then
    echo "UNEXPECTED: the historical form compiled — MSVC grew a to_sys(), so this check can go"
    exit 1
  fi
  echo "OK: the historical form is still rejected by cl.exe (this is what CI saw)"
  exit 0
fi

[ -f "$out_dir/probe.exe" ] || { echo "FAIL: cl.exe did not produce an exe (see the errors above)"; exit 1; }

"$out_dir/probe.exe" || { echo "FAIL: the conversion is off by more than a second"; exit 1; }
echo "PASS: unix_seconds() compiles and converts correctly on MSVC"
