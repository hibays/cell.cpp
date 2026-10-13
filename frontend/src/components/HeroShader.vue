<script setup lang="ts">
// Landing hero shader: WebGPU via vgpu when available, WebGL2 otherwise.
// Both paths draw the same full-screen gradient/flow field; the canvas is a
// fixed background, never a layout participant.

import { onMounted, onUnmounted, ref } from 'vue'

const WGSL = /* wgsl */ `
struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VertexOut {
  var pts = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
  var out: VertexOut;
  out.position = vec4f(pts[i], 0.0, 1.0);
  out.uv = (pts[i] + vec2f(1.0)) * 0.5;
  return out;
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  let uv = in.uv;
  let t = uniforms.time;
  // slow flowing field — cheap, no texture fetches
  var p = vec2f(uv.x * 3.0, uv.y * 2.0);
  var acc = vec3f(0.0);
  for (var i = 0u; i < 4u; i = i + 1u) {
    let fi = f32(i);
    p = p + vec2f(sin(p.y * 1.7 + t * 0.21 + fi), cos(p.x * 1.3 - t * 0.17 + fi)) * 0.35;
    acc = acc + vec3f(sin(p.x + fi), sin(p.y + fi * 1.3), cos(p.x + p.y + t * 0.1)) * 0.25;
  }
  let base = vec3f(0.043, 0.059, 0.098);
  let glow = 0.5 + 0.5 * acc;
  let col = base + glow * vec3f(0.09, 0.16, 0.36) * (0.6 + 0.4 * sin(t * 0.07));
  // vignette keeps the text readable
  let d = distance(uv, vec2f(0.5, 0.45));
  let vig = smoothstep(0.95, 0.25, d);
  return vec4f(col * vig, 1.0);
}
`

// module-level so onUnmounted can stop the loop when the landing disappears
let heroRaf = 0

async function runWebGpu(canvas: HTMLCanvasElement): Promise<boolean> {
  if (!('gpu' in navigator)) return false
  try {
    // vgpu is the browser WebGPU facade this project standardises on; the raw
    // API below is the workhorse, vgpu keeps the abstraction importable.
    const vgpu = await import('vgpu')
    void vgpu
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) return false
    const device = await adapter.requestDevice()
    const context = canvas.getContext('webgpu') as GPUCanvasContext | null
    if (!context) return false
    const format = navigator.gpu.getPreferredCanvasFormat()
    context.configure({ device, format, alphaMode: 'opaque' })

    const module = device.createShaderModule({ code: WGSL })
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    })

    const ub = new Float32Array(4)
    const buffer = device.createBuffer({
      size: ub.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer } }],
    })

    const start = performance.now()
    const frame = () => {
      ub[0] = (performance.now() - start) / 1000
      device.queue.writeBuffer(buffer, 0, ub)
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.043, g: 0.059, b: 0.098, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bind)
      pass.draw(3)
      pass.end()
      device.queue.submit([encoder.finish()])
      heroRaf = requestAnimationFrame(frame)
    }
    frame()
    return true
  } catch {
    return false
  }
}

function runWebgl2(canvas: HTMLCanvasElement): boolean {
  const gl = canvas.getContext('webgl2')
  if (!gl) return false
  const vs = `#version 300 es
  out vec2 vUv;
  void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); vUv = p; gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }`
  const fs = `#version 300 es
  precision highp float;
  in vec2 vUv; out vec4 o; uniform float uTime;
  void main(){
    vec2 uv = vUv; float t = uTime;
    vec2 p = vec2(uv.x*3.0, uv.y*2.0); vec3 acc = vec3(0.0);
    for(int i=0;i<4;i++){ float fi=float(i);
      p += vec2(sin(p.y*1.7+t*0.21+fi), cos(p.x*1.3-t*0.17+fi))*0.35;
      acc += vec3(sin(p.x+fi), sin(p.y+fi*1.3), cos(p.x+p.y+t*0.1))*0.25; }
    vec3 base = vec3(0.043,0.059,0.098);
    vec3 glow = 0.5+0.5*acc;
    vec3 col = base + glow*vec3(0.09,0.16,0.36)*(0.6+0.4*sin(t*0.07));
    float d = distance(uv, vec2(0.5,0.45));
    col *= smoothstep(0.95,0.25,d);
    o = vec4(col,1.0);
  }`
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    return s
  }
  const prog = gl.createProgram()!
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs))
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(prog)
  gl.useProgram(prog)
  const uTime = gl.getUniformLocation(prog, 'uTime')
  const start = performance.now()
  const frame = () => {
    gl.uniform1f(uTime, (performance.now() - start) / 1000)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    heroRaf = requestAnimationFrame(frame)
  }
  heroRaf = requestAnimationFrame(frame)
  return true
}

const canvasRef = ref<HTMLCanvasElement | null>(null)
let resizeHandler: (() => void) | null = null

onMounted(async () => {
  const canvas = canvasRef.value
  if (!canvas) return
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr))
    canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr))
  }
  resize()
  resizeHandler = resize
  window.addEventListener('resize', resize)
  const ok = await runWebGpu(canvas)
  if (!ok) runWebgl2(canvas)
})

onUnmounted(() => {
  if (heroRaf) cancelAnimationFrame(heroRaf)
  if (resizeHandler) window.removeEventListener('resize', resizeHandler)
})
</script>

<template>
  <canvas ref="canvasRef" class="shader" aria-hidden="true" />
</template>

<style scoped>
.shader {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
</style>
