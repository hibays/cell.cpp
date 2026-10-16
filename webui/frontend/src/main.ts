import { createApp } from 'vue'
import { applyTheme, resolveTheme } from './lib/theme'
import App from './App.vue'
// oxlint-disable-next-line import/no-unassigned-import -- CSS side effect
import './styles/tokens.css'
// oxlint-disable-next-line import/no-unassigned-import -- CSS side effect
import './styles/markdown.css'

// before mount: the tokens key off body[data-theme], and a late switch flashes
applyTheme(resolveTheme())

createApp(App).mount('#app')
