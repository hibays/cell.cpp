// Permission fences (the 围栏).
//
// The kernel owns two switches: `sandbox_mode` ("read-only" | "edit-only" |
// "full-access") and `autoallow`. This module turns them into a *replayable*
// selection the UI can reason about, instead of an opaque external switch whose
// state has to be read back.
//
// Two invariants are enforced here rather than trusting the caller:
//   1. cell.cpp only honours autoallow under SandboxMode::FullAccess, so
//      auto-allow under a tighter mode is normalised back to "ask".
//   2. escalation is strictly widening — a fence can be loosened during a turn,
//      never silently tightened, which is what makes "approve and continue"
//      safe to show.

export const SANDBOX_MODES = ['read-only', 'edit-only', 'full-access'] as const
export type SandboxMode = (typeof SANDBOX_MODES)[number]

export type ApprovalPolicy = 'ask' | 'never'
export type PresetId = 'safe' | 'standard' | 'auto' | 'custom'

export interface PermissionSelection {
  preset: PresetId
  sandbox: SandboxMode
  approval: ApprovalPolicy
}

export interface PresetDef {
  sandbox: SandboxMode
  approval: ApprovalPolicy
  name: string
  description: string
}

export const PRESETS: Record<Exclude<PresetId, 'custom'>, PresetDef> = {
  safe: {
    sandbox: 'read-only',
    approval: 'ask',
    name: 'Safe',
    description: 'Read-only. Every write or command must be approved.',
  },
  standard: {
    sandbox: 'edit-only',
    approval: 'ask',
    name: 'Standard',
    description: 'Can edit files in the workspace. Commands still ask first.',
  },
  auto: {
    sandbox: 'full-access',
    approval: 'never',
    name: 'Auto',
    description: 'Full access with auto-allow: no per-action prompt.',
  },
}

const RANK: Record<SandboxMode, number> = {
  'read-only': 0,
  'edit-only': 1,
  'full-access': 2,
}

export function rank(mode: SandboxMode): number {
  return RANK[mode] ?? 0
}

export function applyPreset(id: Exclude<PresetId, 'custom'>): PermissionSelection {
  const p = PRESETS[id]
  return { preset: id, sandbox: p.sandbox, approval: p.approval }
}

function presetFor(sandbox: SandboxMode, approval: ApprovalPolicy): PresetId {
  for (const id of ['safe', 'standard', 'auto'] as const) {
    const p = PRESETS[id]
    if (p.sandbox === sandbox && p.approval === approval) return id
  }
  return 'custom'
}

/**
 * Enforce the kernel invariants and recompute which preset the result matches.
 * Anything the kernel cannot honour is corrected here rather than sent back.
 */
export function normalize(sel: {
  sandbox: SandboxMode
  approval: ApprovalPolicy
  preset?: PresetId
}): PermissionSelection {
  const sandbox = (SANDBOX_MODES as readonly string[]).includes(sel.sandbox)
    ? sel.sandbox
    : 'read-only'
  // autoallow is gated on FullAccess in the kernel
  const approval: ApprovalPolicy = sel.approval === 'never' && sandbox === 'full-access' ? 'never' : 'ask'
  return { preset: presetFor(sandbox, approval), sandbox, approval }
}

export function canEscalate(from: SandboxMode, to: SandboxMode): boolean {
  return rank(to) > rank(from)
}

export function escalate(from: SandboxMode, to: SandboxMode): SandboxMode {
  if (!canEscalate(from, to)) {
    throw new Error(`cannot escalate ${from} -> ${to}: target is not strictly wider`)
  }
  return to
}

export interface KernelConfigLike {
  sandbox_mode?: string
  autoallow?: boolean
}

/** Kernel config -> selection. An unrecognised mode is reported as `custom`. */
export function fromKernelConfig(cfg: KernelConfigLike | undefined): PermissionSelection {
  const raw = typeof cfg?.sandbox_mode === 'string' ? cfg.sandbox_mode : ''
  const known = (SANDBOX_MODES as readonly string[]).includes(raw)
  const sandbox = (known ? raw : 'read-only') as SandboxMode
  const approval: ApprovalPolicy = cfg?.autoallow === true ? 'never' : 'ask'
  const sel = normalize({ sandbox, approval })
  return known ? sel : { ...sel, preset: 'custom' }
}

/** Selection -> the PATCH body for /v1/config. */
export function toKernelPatch(sel: PermissionSelection): { sandbox_mode: string; autoallow: boolean } {
  const n = normalize(sel)
  return { sandbox_mode: n.sandbox, autoallow: n.approval === 'never' }
}
