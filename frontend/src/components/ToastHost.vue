<script setup lang="ts">
import { store } from '../store'
</script>

<template>
  <div class="toasts" aria-live="polite">
    <div v-for="t in store.toasts" :key="t.id" class="toast" :class="t.kind">
      <span class="icon">
        {{ t.kind === 'ok' ? '✓' : t.kind === 'bad' ? '✕' : t.kind === 'warn' ? '!' : 'i' }}
      </span>
      <span class="text">{{ t.text }}</span>
    </div>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  right: 18px;
  bottom: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 60;
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--bg-elev-2);
  border: 1px solid var(--line);
  border-left-width: 3px;
  border-radius: var(--radius-sm);
  padding: 9px 14px;
  font-size: 13px;
  box-shadow: var(--shadow);
  animation: cell-fade-in 0.2s ease both;
  max-width: 380px;
}

.icon {
  font-family: var(--mono);
  font-weight: 700;
}

.toast.ok {
  border-left-color: var(--ok);
}
.toast.ok .icon {
  color: var(--ok);
}

.toast.bad {
  border-left-color: var(--bad);
}
.toast.bad .icon {
  color: var(--bad);
}

.toast.warn {
  border-left-color: var(--warn);
}
.toast.warn .icon {
  color: var(--warn);
}

.toast.info {
  border-left-color: var(--accent);
}
.toast.info .icon {
  color: var(--accent);
}

.text {
  color: var(--ink);
}
</style>
