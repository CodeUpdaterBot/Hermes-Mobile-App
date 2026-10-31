/**
 * The wide (tri-fold) workspace layout, as the user left it.
 *
 * Two things are remembered: the dragged column widths and which columns are collapsed.
 * Null width means "use the stylesheet's responsive value", so a user who never drags a
 * divider keeps the design's defaults instead of freezing today's pixel value.
 *
 * The right column (the Bot's computer and routines) is a destination, not a default: the
 * conversation gets the space until the user asks for the pane. The Bots rail stays, because
 * moving between Bots is the primary job of the wide layout. Once the user makes a choice it
 * is theirs — the default only applies to a layout nothing has been stored for.
 */
export type WideLayout = {
  railWidth: number | null
  contextWidth: number | null
  railCollapsed: boolean
  contextCollapsed: boolean
}

export const WIDE_LAYOUT_KEY = 'hermes-mobile-wide-layout'

/**
 * The viewport that earns the tri-fold workspace (unfolded foldables, tablets).
 *
 * 900px alone misses book-style foldables: an unfolded iPhone Duo is ~626pt wide and a Galaxy
 * Z Fold with a larger Screen zoom drops well below 900. Any viewport that is at least 600px
 * on BOTH axes is an unfolded/tablet surface (a phone is never that tall in landscape nor that
 * wide in portrait), and the rail + conversation grid needs only ~600px.
 */
export const WIDE_QUERY = '(min-width: 900px), (min-width: 600px) and (min-height: 600px)'

/** Mirrors WIDE_QUERY for callers (and tests) that have dimensions rather than a media query. */
export const isWideViewport = (width: number, height: number) => width >= 900 || (width >= 600 && height >= 600)

export const DEFAULT_WIDE_LAYOUT: WideLayout = {
  railWidth: null,
  contextWidth: null,
  railCollapsed: false,
  contextCollapsed: true,
}

/** Matches the drag clamp in the shell, so a stored width can never exceed what is draggable. */
const clampWidth = (value: number) => Math.max(180, Math.min(460, Math.round(value)))

const readWidth = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? clampWidth(value) : null)

/**
 * Tolerant parse: a corrupt, partial or unexpected payload falls back per field, so one bad
 * key cannot throw away the rest of the user's layout.
 */
export function parseWideLayout(raw: string | null): WideLayout {
  if (!raw) return DEFAULT_WIDE_LAYOUT
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return DEFAULT_WIDE_LAYOUT }
  if (!parsed || typeof parsed !== 'object') return DEFAULT_WIDE_LAYOUT
  const value = parsed as Partial<Record<keyof WideLayout, unknown>>
  return {
    railWidth: 'railWidth' in value ? readWidth(value.railWidth) : DEFAULT_WIDE_LAYOUT.railWidth,
    contextWidth: 'contextWidth' in value ? readWidth(value.contextWidth) : DEFAULT_WIDE_LAYOUT.contextWidth,
    railCollapsed: typeof value.railCollapsed === 'boolean' ? value.railCollapsed : DEFAULT_WIDE_LAYOUT.railCollapsed,
    contextCollapsed: typeof value.contextCollapsed === 'boolean' ? value.contextCollapsed : DEFAULT_WIDE_LAYOUT.contextCollapsed,
  }
}

type ReadStore = { getItem(key: string): string | null }
type WriteStore = { setItem(key: string, value: string): void }

/** Storage may be unavailable (private mode); a missing layout is not an error. */
export function readWideLayout(store: ReadStore | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): WideLayout {
  if (!store) return DEFAULT_WIDE_LAYOUT
  try { return parseWideLayout(store.getItem(WIDE_LAYOUT_KEY)) } catch { return DEFAULT_WIDE_LAYOUT }
}

export function saveWideLayout(layout: WideLayout, store: WriteStore | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): void {
  if (!store) return
  try { store.setItem(WIDE_LAYOUT_KEY, JSON.stringify(layout)) } catch { /* keep the in-memory value */ }
}

/** The conversation's minimum, the side columns' comfortable minimum and default, and both dividers. */
export const MAIN_MIN = 340
const SIDE_MIN = 248
const SIDE_DEFAULT = 296
const DIVIDERS = 14

/** Narrowest viewport that shows the Bots rail, the conversation and the computer column together. */
export const THREE_COLUMN_MIN = SIDE_MIN * 2 + MAIN_MIN + DIVIDERS

export type WideColumns = {
  rail: number
  context: number
  railHidden: boolean
  contextHidden: boolean
  /** The rail is hidden only because the computer column needs the room (not the user's choice). */
  railAutoHidden: boolean
  template: string
}

/**
 * Fit the stored layout to the viewport. A Galaxy Z Fold7's inner screen (~757px) cannot hold
 * all three columns, so there the open computer column takes the rail's place until it is closed;
 * otherwise side columns shrink (never the conversation below MAIN_MIN) so nothing runs off-screen.
 * The stored layout is not changed: the same choice comes back on a wider screen.
 */
export function fitWideColumns(layout: WideLayout, viewportWidth: number): WideColumns {
  const contextHidden = layout.contextCollapsed
  const railAutoHidden = !layout.railCollapsed && !contextHidden && viewportWidth < THREE_COLUMN_MIN
  const railHidden = layout.railCollapsed || railAutoHidden
  let rail = railHidden ? 0 : layout.railWidth ?? SIDE_DEFAULT
  let context = contextHidden ? 0 : layout.contextWidth ?? SIDE_DEFAULT
  const room = Math.max(0, viewportWidth - DIVIDERS - MAIN_MIN)
  if (rail + context > room) {
    const scale = room / (rail + context)
    rail = Math.floor(rail * scale)
    context = Math.floor(context * scale)
  }
  return { rail, context, railHidden, contextHidden, railAutoHidden, template: `${rail}px 7px minmax(${MAIN_MIN}px,1fr) 7px ${context}px` }
}
