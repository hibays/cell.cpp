// Theme: <body data-theme="…"> is the switch, exactly like the reference
// harness (`ui-layout/src/client/theme-presenter.ts` writes a body attribute
// and lets CSS do the rest). No framework state is involved, so the theme is
// already correct on the first paint — the inline bootstrap below runs before
// Vue mounts.

export type ThemeName = 'dark' | 'light'

const KEY = 'cell.theme'

function stored(): ThemeName | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'dark' || v === 'light' ? v : null
  } catch {
    return null // private mode / no storage: fall through to the system
  }
}

function systemPrefers(): ThemeName {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/** Persisted choice, else the system preference (dark is our default face). */
export function resolveTheme(): ThemeName {
  return stored() ?? systemPrefers()
}

export function applyTheme(t: ThemeName): void {
  document.body.dataset.theme = t
  document.documentElement.style.colorScheme = t
}

export function saveTheme(t: ThemeName): void {
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* not fatal: the theme simply will not persist */
  }
}
