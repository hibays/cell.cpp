import { createApp } from 'vue'
import App from './App.vue'
// oxlint-disable-next-line import/no-unassigned-import -- CSS side effect
import './styles/tokens.css'
// oxlint-disable-next-line import/no-unassigned-import -- CSS side effect
import './styles/markdown.css'

createApp(App).mount('#app')
