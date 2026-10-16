<script setup lang="ts">
import { onMounted } from 'vue'
import { boot, store } from './store'
import { useShortcuts } from './lib/shortcuts'
import LandingView from './views/LandingView.vue'
import OnboardingView from './views/OnboardingView.vue'
import AppShell from './views/AppShell.vue'
import ToastHost from './components/ToastHost.vue'

useShortcuts()

onMounted(() => {
  void boot()
})
</script>

<template>
  <div class="root">
    <LandingView v-if="store.phase === 'landing' || store.phase === 'booting'" />
    <OnboardingView v-else-if="store.phase === 'onboarding'" />
    <AppShell v-else />
    <ToastHost />
  </div>
</template>

<style scoped>
.root {
  height: 100%;
}
</style>
