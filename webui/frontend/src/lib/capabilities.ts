// Agent capability summary.
//
// Describes what the agent can actually do, derived from the three sources that
// exist today: /v1/config (switches), /v1/skills (inventory) and /v1/usages
// (spend).
//
// Deliberate honesty: the teamwork and compaction endpoints are still roadmap
// (docs/RESTful.md §3.9), so this reports their *configured* state and marks
// them planned. The panel must never present a control that has no endpoint
// behind it.

import type { ConfigSnapshot } from './api'

export interface Skill {
  name: string
  description: string
  file: string
}

export interface UsageEntry {
  tok_in?: number
  tok_out?: number
}

export interface CapabilityInput {
  config?: Partial<ConfigSnapshot> | null
  skills?: { skills?: (Skill | null)[] | null } | null
  usage?: { models?: Record<string, UsageEntry | undefined> | null } | null
}

export interface CapabilitySummary {
  tools: boolean
  maxThreads: number
  teamworkChildren: number
  teamworkEnabled: boolean
  compaction: { auto: boolean; provider: string; model: string }
  skills: Skill[]
  usage: { tokIn: number; tokOut: number; models: number }
  /** Human-readable reasons the agent is currently limited. */
  degraded: string[]
}

export interface CapabilityRow {
  label: string
  value: string
  hint?: string
}

const int = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : fallback
}

export function summarizeCapabilities(input: CapabilityInput = {}): CapabilitySummary {
  const cfg = input.config ?? undefined

  const skills = (input.skills?.skills ?? [])
    .filter((s): s is Skill => !!s && typeof s.name === 'string')
    .map((s) => ({ name: s.name, description: s.description ?? '', file: s.file ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name))

  let tokIn = 0
  let tokOut = 0
  let models = 0
  for (const entry of Object.values(input.usage?.models ?? {})) {
    if (!entry) continue
    models += 1
    tokIn += int(entry.tok_in, 0)
    tokOut += int(entry.tok_out, 0)
  }

  const degraded: string[] = []
  if (!cfg) {
    degraded.push('配置未加载，能力状态未知')
  } else {
    if (cfg.tools !== true) degraded.push('工具调用已关闭，agent 只能对话')
    if (cfg.compact_auto !== true) degraded.push('自动压缩已关闭，长会话可能超出上下文')
  }

  const teamworkChildren = cfg ? int(cfg.teamwork_max_children, 0) : 0

  return {
    tools: cfg?.tools === true,
    maxThreads: cfg ? Math.max(1, int(cfg.max_threads, 1)) : 1,
    teamworkChildren,
    teamworkEnabled: teamworkChildren > 0,
    compaction: {
      auto: cfg?.compact_auto === true,
      // an empty target means "use whatever is current", which is what the
      // kernel does — surface the effective value, not the blank one
      provider: cfg?.compact_provider || cfg?.current_provider || '',
      model: cfg?.compact_model || cfg?.current_model || '',
    },
    skills,
    usage: { tokIn, tokOut, models },
    degraded,
  }
}

export function toRows(s: CapabilitySummary): CapabilityRow[] {
  return [
    { label: '工具调用', value: s.tools ? '开启' : '关闭' },
    { label: '并发只读工具线程', value: String(s.maxThreads) },
    {
      label: '子代理上限',
      value: s.teamworkEnabled ? String(s.teamworkChildren) : '未启用',
      hint: s.teamworkEnabled ? 'teamwork 运行端点仍在规划中' : undefined,
    },
    {
      label: '自动压缩',
      value: s.compaction.auto
        ? s.compaction.model
          ? `${s.compaction.provider}:${s.compaction.model}`
          : '开启'
        : '关闭',
      hint: s.compaction.auto ? '手动触发端点仍在规划中' : undefined,
    },
    { label: '已加载技能', value: `${s.skills.length} 个` },
    { label: '累计 token', value: `${s.usage.tokIn} ↑ ${s.usage.tokOut} ↓` },
  ]
}
