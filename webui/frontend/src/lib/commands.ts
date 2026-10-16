// The composer's `/` command table.
//
// Only commands the shell can actually execute are listed, and each one says
// which side runs it: `kernel` commands go over REST, `shell` ones are local UI
// actions. Commands the CLI has but the service layer does not (🚧 in
// docs/RESTful.md: /clear, /reload, /ins, /save) are deliberately absent — an
// entry that silently does nothing is worse than a missing one.

export type CommandArg =
  | { kind: 'skill' }
  | { kind: 'level' }
  | { kind: 'sandbox' }
  | { kind: 'toggle' }
  | { kind: 'text' }

export interface CommandDef {
  name: string
  desc: string
  /** What the command needs after its name, if anything. */
  arg?: CommandArg
  side: 'kernel' | 'shell'
}

export const COMMANDS: CommandDef[] = [
  { name: '/compact', desc: '手动压缩会话上下文', side: 'kernel' },
  { name: '/skill', desc: '把技能正文加载进会话', arg: { kind: 'skill' }, side: 'kernel' },
  { name: '/think', desc: '调整思考深度', arg: { kind: 'level' }, side: 'kernel' },
  { name: '/sandbox', desc: '切换沙箱与权限预设', arg: { kind: 'sandbox' }, side: 'kernel' },
  { name: '/tool', desc: '开关工具调用', arg: { kind: 'toggle' }, side: 'kernel' },
  { name: '/usages', desc: '查看本机用量与缓存命中', side: 'shell' },
  { name: '/clear', desc: '清空当前会话（记录、中断点与协作任务）', side: 'kernel' },
  { name: '/new', desc: '新建会话', side: 'shell' },
  { name: '/export', desc: '导出当前会话', side: 'shell' },
  { name: '/help', desc: '查看命令与快捷键', side: 'shell' },
]

/** Prefix match, with an exact-name hit first. Empty query lists everything. */
export function matchCommands(query: string): CommandDef[] {
  const q = query.trim().toLowerCase()
  if (!q) return COMMANDS
  const hit = COMMANDS.filter((c) => c.name.slice(1).startsWith(q))
  return hit.toSorted((a, b) => a.name.length - b.name.length)
}

export function findCommand(name: string): CommandDef | undefined {
  return COMMANDS.find((c) => c.name === name)
}

/** Candidate values for a command argument (empty = free text). */
export function argCandidates(
  arg: CommandArg,
  ctx: { skills: string[]; levels: string[]; sandboxes: string[] },
): string[] {
  switch (arg.kind) {
    case 'skill':
      return ctx.skills
    case 'level':
      return ctx.levels
    case 'sandbox':
      return ctx.sandboxes
    case 'toggle':
      return ['on', 'off']
    default:
      return []
  }
}
