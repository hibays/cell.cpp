import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Vapor mode — Vue 3.6 ships the `vapor` compiler flag (and the Vapor runtime).
// The published `vue` in this repo's lockfile is 3.5.x, whose compiler does not
// know the flag yet, so it is enabled automatically the moment `vue` is >= 3.6
// (`bun update vue`). Everything else in the app is written against the plain
// Composition API, so the flip is a one-line upgrade, not a rewrite.
function vaporPlugins() {
  let enabled = false
  try {
    // read the installed vue version without a static import (config runs in node)
    const req = typeof require === 'function' ? require : null
    const pkg: unknown = req ? req('vue/package.json') : null
    const version =
      typeof pkg === 'object' && pkg !== null && 'version' in pkg ? String(pkg.version) : '0.0.0'
    const [major, minor] = version.split('.').map(Number)
    enabled = major > 3 || (major === 3 && minor >= 6)
  } catch {
    enabled = false
  }
  // eslint-disable-next-line no-console
  console.log(
    enabled
      ? '[cell] vapor mode enabled (vue >= 3.6)'
      : '[cell] vapor mode needs vue >= 3.6 (published 3.5.x has no vapor compiler); using the standard runtime',
  )
  return vue(enabled ? ({ vapor: true } as Record<string, unknown>) : undefined)
}

export default defineConfig({
  plugins: [vaporPlugins(), viteSingleFile()],
  build: {
    outDir: 'dist',
    target: 'esnext',
    // the desktop binary embeds a single HTML file: no code splitting, no assets
    assetsInlineLimit: 1024 * 1024,
    chunkSizeWarningLimit: 4096,
  },
  server: {
    port: 5173,
  },
})
