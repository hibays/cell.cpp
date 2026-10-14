// =============================================================================
//  wv2_msvc_compat.cpp — MSVC-CRT compatibility shims for the WebView2 loader
//
//  Microsoft ships the WebView2 loader as `WebView2LoaderStatic.lib`, a set of
//  MSVC-compiled COFF objects. GNU ld (bfd) cannot consume them at all, but
//  LLD can — it only complains about a handful of MSVC runtime symbols that
//  MinGW does not provide. This translation unit defines exactly those, so the
//  loader can be linked statically and `cellui.exe` stays a single file with no
//  `WebView2Loader.dll` beside it.
//
//  Only compiled when the static loader is used with a GNU-flavoured toolchain
//  (MSVC has its own CRT and needs none of this).
//
//  Upstream: WebView2LoaderStatic.lib from NuGet `Microsoft.Web.WebView2`.
// =============================================================================
#if defined(_WIN32) && defined(WEBUI_WEBVIEW_STATIC) && !defined(_MSC_VER)

#include <atomic>
#include <cstdint>
#include <cstdlib>
#include <new>
#include <windows.h>

extern "C" {

// ---------------------------------------------------------------------------
//  /GS stack cookie — MSVC's runtime normally seeds this at startup; a fixed
//  value is enough here (the cookie only guards the loader's own frames).
// ---------------------------------------------------------------------------
uintptr_t __security_cookie = 0x0BB40E64EFAE9A9Bull;

extern "C" void __fastcall __security_check_cookie(uintptr_t cookie)
{
    if (cookie != __security_cookie)
        std::abort();
}

// ---------------------------------------------------------------------------
//  Thread-safe static locals — MSVC's `_Init_thread_header/footer` pair.
//
//  Contract of the generated code:
//      if (guard == 0) {
//          _Init_thread_header(&guard);
//          if (guard == -1) { ...run the constructor...; _Init_thread_footer(&guard); }
//      }
//  so `header` must block while another thread owns the initialisation, and
//  `footer` must publish a value that is neither 0 nor -1.
// ---------------------------------------------------------------------------
long _Init_thread_epoch = 1;

void __cdecl _Init_thread_header(int *guard)
{
    for (;;)
    {
        int cur = __atomic_load_n(guard, __ATOMIC_ACQUIRE);
        if (cur == -1)
        {
            Sleep(1); // another thread owns the initialisation
            continue;
        }
        if (cur != 0)
            return; // already initialised
        if (__sync_bool_compare_and_swap(guard, 0, -1))
            return; // this thread initialises
    }
}

void __cdecl _Init_thread_footer(int *guard)
{
    const long epoch = __atomic_add_fetch(&_Init_thread_epoch, 1, __ATOMIC_ACQ_REL);
    __atomic_store_n(guard, static_cast<int>(epoch), __ATOMIC_RELEASE);
}

} // extern "C"

// ---------------------------------------------------------------------------
//  C++ runtime — the loader only asks for the sized/nothrow flavours, which
//  MinGW mangles differently (Itanium ABI vs. MSVC ABI), so they are published
//  under the MSVC-mangled names using assembler labels.
// ---------------------------------------------------------------------------
extern const std::nothrow_t msvc_std_nothrow __asm__("\"?nothrow@std@@3Unothrow_t@1@B\"");
const std::nothrow_t msvc_std_nothrow{};

extern "C" void *msvc_new_array(unsigned long long n) __asm__("\"??_U@YAPEAX_K@Z\"");
void *msvc_new_array(unsigned long long n) { return ::operator new(static_cast<size_t>(n)); }

extern "C" void *msvc_new_nothrow(unsigned long long n, const std::nothrow_t &) __asm__("\"??2@YAPEAX_KAEBUnothrow_t@std@@@Z\"");
void *msvc_new_nothrow(unsigned long long n, const std::nothrow_t &) { return std::malloc(static_cast<size_t>(n)); }

extern "C" void msvc_delete_sized(void *p, unsigned long long) __asm__("\"??3@YAXPEAX_K@Z\"");
void msvc_delete_sized(void *p, unsigned long long) { std::free(p); }

extern "C" void msvc_delete_array(void *p) __asm__("\"??_V@YAXPEAX@Z\"");
void msvc_delete_array(void *p) { std::free(p); }

#endif // _WIN32 && WEBUI_WEBVIEW_STATIC && !_MSC_VER
