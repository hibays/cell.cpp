// Column solver for the three-column shell.
//
// Ported from the reference desktop harness (`ui-layout/src/client/columns.ts`),
// whose split is: pure functions decide the discrete widths, CSS Grid does the
// squeezing. Keeping the arithmetic here — instead of inside the component —
// means the layout rules are testable without a DOM, which is how the harness
// keeps a 300-line frame component honest.

export const CENTER_MIN = 400
export const SIDEBAR_MIN = 264
export const SIDEBAR_MAX = 420
export const SIDEBAR_DEFAULT = 280
export const SIDEBAR_COLLAPSED = 56
/** Below this the sidebar auto-collapses to the icon rail. */
export const SIDEBAR_AUTO_COLLAPSE = 1024
export const RIGHTBAR_MAX_RATIO = 0.7
export const RIGHTBAR_DEFAULT_RATIO = 0.45

export interface Columns {
  sidebar: number
  rightbar: number
  collapsed: boolean
}

export interface ColumnInput {
  /** Frame width in CSS pixels. */
  width: number
  /** Preferred sidebar width (persisted), ignored when collapsed. */
  sidebarWidth: number
  /** Explicit collapse (user toggle) — auto-collapse is derived here. */
  collapsed: boolean
  rightbarOpen: boolean
  /** Preferred right-bar width, ignored when closed. */
  rightbarWidth: number
}

export function clampSidebar(w: number): number {
  if (!Number.isFinite(w)) return SIDEBAR_DEFAULT
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)))
}

/** The right bar never eats more than its share, and never squeezes the centre below its minimum. */
export function clampRightbar(w: number, width: number): number {
  const room = Math.max(0, width - CENTER_MIN - SIDEBAR_COLLAPSED)
  const cap = Math.min(room, Math.round(width * RIGHTBAR_MAX_RATIO))
  if (!Number.isFinite(w)) return Math.round(cap * RIGHTBAR_DEFAULT_RATIO)
  return Math.max(0, Math.min(cap, Math.round(w)))
}

export function solveColumns(input: ColumnInput): Columns {
  const width = Math.max(0, input.width)
  // Auto-collapse is a property of the frame, not of the user's preference: a
  // narrow window shows the rail and remembers the width for later.
  const autoCollapsed = width > 0 && width < SIDEBAR_AUTO_COLLAPSE
  const collapsed = input.collapsed || autoCollapsed
  const sidebar = collapsed ? SIDEBAR_COLLAPSED : clampSidebar(input.sidebarWidth)
  const rightbar = input.rightbarOpen ? clampRightbar(input.rightbarWidth, width) : 0
  return { sidebar, rightbar, collapsed }
}

/** The grid template the frame hands to CSS; `0px` keeps a closed column addressable. */
export function gridTemplate(cols: Columns): string {
  const right = cols.rightbar > 0 ? `minmax(0px, ${cols.rightbar}px)` : '0px'
  return `${cols.sidebar}px minmax(${CENTER_MIN}px, 1fr) ${right}`
}
