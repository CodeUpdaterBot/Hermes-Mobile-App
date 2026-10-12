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

/** The viewport width that earns the tri-fold workspace (unfolded foldables, tablets). */
export const WIDE_QUERY = '(min-width: 900px)'

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
