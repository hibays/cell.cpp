<script setup lang="ts">
import { onMounted, ref, useTemplateRef } from 'vue'
import { boot, enterApp, store } from '../store'
import HeroShader from '../components/HeroShader.vue'
import { revealStagger } from '../lib/motion'

const booting = ref(store.phase === 'booting')
const error = ref(store.bootError)
const content = useTemplateRef<HTMLElement>('content')

onMounted(async () => {
  if (store.phase === 'booting') await boot()
  booting.value = false
  error.value = store.bootError
  if (content.value)
    revealStagger(Array.from(content.value.querySelectorAll('.brand, .title, .sub, .actions, .hint')), 0.15)
})
</script>

<template>
  <div class="landing">
    <HeroShader />
    <div ref="content" class="content">
      <div class="brand">
        <span class="dot" />
        <span class="name">cell</span>
        <span class="ver">{{ store.bootstrap?.version ?? '' }}</span>
      </div>
      <h1 class="title">
        一个 <em>编码代理</em>，<br />
        住进你的桌面
      </h1>
      <p class="sub">
        单文件 C++26 内核 · RESTful + SSE 服务层 · WebView2 桌面壳。<br />
        连接 OpenAI / Anthropic 或任何兼容网关，让它读写、执行、编排子代理。
      </p>
      <div class="actions">
        <button v-if="!booting && !error" class="cta" @click="enterApp()">进入工作区</button>
        <button v-else-if="booting" class="cta" disabled>正在连接内核…</button>
        <button v-else class="cta" @click="enterApp()">仍要进入（内核未就绪）</button>
      </div>
      <div class="hint">
        <kbd>Ctrl</kbd>+<kbd>K</kbd> 命令面板 · <kbd>Ctrl</kbd>+<kbd>N</kbd> 新会话 · <kbd>Esc</kbd> 中断生成
      </div>
    </div>
    <footer class="foot">
      <span v-if="store.bootstrap?.platform">
        {{ store.bootstrap.platform[0] }} · {{ store.bootstrap.platform[1] }}bit
      </span>
    </footer>
  </div>
</template>

<style scoped>
.landing {
  position: relative;
  height: 100%;
  overflow: hidden;
}

.content {
  position: relative;
  z-index: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 8vw;
  animation: cell-fade-in 0.7s ease both;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 28px;
  font-family: var(--mono);
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 18px var(--accent);
}

.name {
  font-size: 18px;
  letter-spacing: 0.08em;
}

.ver {
  color: var(--ink-faint);
  font-size: 12px;
}

.title {
  font-size: clamp(34px, 5vw, 58px);
  line-height: 1.15;
  margin: 0 0 20px;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.title em {
  font-style: normal;
  background: linear-gradient(100deg, #60a5fa, #a78bfa 60%, #f472b6);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.sub {
  color: var(--ink-dim);
  max-width: 46em;
  margin: 0 0 36px;
}

.actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.cta {
  border: 0;
  border-radius: 999px;
  padding: 12px 30px;
  font-size: 15px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(120deg, #2563eb, #7c3aed);
  box-shadow: 0 12px 34px rgba(37, 99, 235, 0.35);
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;
}

.cta:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 16px 40px rgba(37, 99, 235, 0.45);
}

.cta:disabled {
  opacity: 0.6;
  cursor: progress;
}

.cta.error {
  background: rgba(239, 68, 68, 0.14);
  color: #fca5a5;
  box-shadow: none;
  font-weight: 500;
  font-size: 13px;
}

.hint {
  margin-top: 30px;
  color: var(--ink-faint);
  font-size: 12.5px;
}

kbd {
  font-family: var(--mono);
  font-size: 11px;
  background: var(--bg-elev-2);
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 1px 6px;
}

.foot {
  position: absolute;
  bottom: 22px;
  left: 8vw;
  color: var(--ink-faint);
  font-size: 12px;
  font-family: var(--mono);
}
</style>
