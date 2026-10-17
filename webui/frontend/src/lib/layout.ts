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

/**
 * The frame's five grid slots. The template always has five columns — the two
 * handle columns are 0px and the handles themselves overflow them by design
 * (width 6px, margin -3px) — so a child's column never depends on which of the
 * others happen to be rendered. Auto-placement does exactly that: with a
 * three-column template and a conditionally rendered left handle, the main
 * column used to land in the 0px rightbar slot (the whole conversation
 * invisible) whenever the sidebar was expanded. Every child therefore carries
 * its slot explicitly, and this table is the single source both the template
 * and the components read — layout.test pins the two against each other.
 */
export const SLOT = {
  sidebar: 1,
  handleSidebar: 2,
  main: 3,
  handleRightbar: 4,
  rightbar: 5,
} as const

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

/**
 * The grid template the frame hands to CSS. Always five columns (see SLOT):
 * a closed column is `0px` rather than absent, so the slot numbers stay valid
 * whichever children are mounted, and CSS Grid — not the JS — does the
 * squeezing between the sidebar, the centre's minimum and the right bar.
 */
export function gridTemplate(cols: Columns): string {
  const right = cols.rightbar > 0 ? `minmax(0px, ${cols.rightbar}px)` : '0px'
  return `${cols.sidebar}px 0px minmax(${CENTER_MIN}px, 1fr) 0px ${right}`
}
