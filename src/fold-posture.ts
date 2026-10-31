/**
 * Foldable posture: whether the screen is flat, folded like a book (vertical hinge) or
 * propped up like a laptop/tabletop (horizontal hinge), and where the hinge is in CSS px.
 *
 * Two sources are read, the native one first:
 * - Android: MainActivity forwards Jetpack WindowManager's FoldingFeature as
 *   `window.__HERMES_FOLD__` and dispatches a `hermes-fold` event (already in CSS px).
 * - The Viewport Segments API (`window.viewport.segments`), for WebViews that expose it.
 * A fully opened phone is one continuous display, so it is always `flat` and has no hinge.
 */
export type FoldPosture = 'flat' | 'book' | 'tabletop'

export type FoldRect = { x: number; y: number; width: number; height: number }

export type FoldState = { posture: FoldPosture; hinge: FoldRect | null }

export type NativeFold = {
  state: 'flat' | 'half_opened'
  orientation: 'vertical' | 'horizontal'
  separating: boolean
  bounds: FoldRect
} | null

export const FOLD_EVENT = 'hermes-fold'

export const FLAT: FoldState = { posture: 'flat', hinge: null }

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const isRect = (value: unknown): value is FoldRect => {
  if (!value || typeof value !== 'object') return false
  const rect = value as Record<string, unknown>
  return finite(rect.x) && finite(rect.y) && finite(rect.width) && finite(rect.height) && rect.width >= 0 && rect.height >= 0
}

/** Two side-by-side segments mean a vertical hinge (book); two stacked ones a horizontal hinge (tabletop). */
export function stateFromSegments(segments: readonly unknown[] | null | undefined): FoldState {
  if (!segments || segments.length !== 2 || !segments.every(isRect)) return FLAT
  const [first, second] = [...(segments as FoldRect[])].sort((a, b) => a.x - b.x || a.y - b.y)
  const firstRight = first.x + first.width
  const firstBottom = first.y + first.height
  if (second.x >= firstRight - 1 && Math.abs(second.y - first.y) < 1) {
    return { posture: 'book', hinge: { x: firstRight, y: 0, width: Math.max(0, second.x - firstRight), height: Math.max(first.height, second.height) } }
  }
  if (second.y >= firstBottom - 1) {
    return { posture: 'tabletop', hinge: { x: 0, y: firstBottom, width: Math.max(first.width, second.width), height: Math.max(0, second.y - firstBottom) } }
  }
  return FLAT
}

/** A Jetpack FoldingFeature: only a half-opened or physically separating hinge changes the layout. */
export function stateFromNative(feature: unknown): FoldState {
  if (!feature || typeof feature !== 'object') return FLAT
  const fold = feature as Record<string, unknown>
  if (!isRect(fold.bounds)) return FLAT
  if (fold.state !== 'half_opened' && fold.separating !== true) return FLAT
  if (fold.orientation === 'vertical') return { posture: 'book', hinge: { ...fold.bounds } }
  if (fold.orientation === 'horizontal') return { posture: 'tabletop', hinge: { ...fold.bounds } }
  return FLAT
}

/**
 * The native report wins once the activity has sent one (even a flat one), because it knows
 * the real hinge state; segments are the fallback for WebViews without the native bridge.
 */
export function resolveFoldState(native: unknown, segments: readonly unknown[] | null | undefined): FoldState {
  if (native !== undefined) return stateFromNative(native)
  return stateFromSegments(segments)
}

type FoldWindow = {
  __HERMES_FOLD__?: unknown
  HermesFoldBridge?: { state(): string }
  viewport?: { segments?: readonly unknown[] | null }
}

/** The Android JavascriptInterface survives reloads; the pushed global is only set after a change. */
function readNativeFold(win: FoldWindow): unknown {
  if (win.__HERMES_FOLD__ !== undefined) return win.__HERMES_FOLD__
  try {
    const raw = win.HermesFoldBridge?.state()
    return typeof raw === 'string' ? JSON.parse(raw) : undefined
  } catch { return undefined }
}

export function readFoldState(win: FoldWindow | undefined = typeof window === 'undefined' ? undefined : window as unknown as FoldWindow): FoldState {
  if (!win) return FLAT
  let segments: readonly unknown[] | null | undefined
  try { segments = win.viewport?.segments } catch { segments = undefined }
  return resolveFoldState(readNativeFold(win), segments)
}

export const sameFoldState = (a: FoldState, b: FoldState) =>
  a.posture === b.posture
  && (a.hinge === b.hinge || (!!a.hinge && !!b.hinge && a.hinge.x === b.hinge.x && a.hinge.y === b.hinge.y && a.hinge.width === b.hinge.width && a.hinge.height === b.hinge.height))

/** Exposes the posture to CSS as `html[data-posture]` plus `--hinge-*` custom properties. */
export function applyFoldState(state: FoldState, root: HTMLElement | undefined = typeof document === 'undefined' ? undefined : document.documentElement): void {
  if (!root) return
  root.dataset.posture = state.posture
  const vars: Array<[string, number]> = state.hinge
    ? [['--hinge-x', state.hinge.x], ['--hinge-y', state.hinge.y], ['--hinge-width', state.hinge.width], ['--hinge-height', state.hinge.height]]
    : []
  for (const name of ['--hinge-x', '--hinge-y', '--hinge-width', '--hinge-height']) root.style.removeProperty(name)
  for (const [name, value] of vars) root.style.setProperty(name, `${Math.round(value)}px`)
}

/**
 * In book posture the Bots rail is the left page and the conversation the right page, so
 * the divider sits exactly on the hinge and nothing straddles the crease. Returns null when
 * the hinge would leave either page too narrow to be useful.
 */
export function bookColumns(hinge: FoldRect, viewportWidth: number, minRail = 180, minMain = 300): string | null {
  const divider = Math.max(7, Math.round(hinge.width))
  const rail = Math.round(hinge.x - (divider - hinge.width) / 2)
  if (rail < minRail || viewportWidth - rail - divider < minMain) return null
  return `${rail}px ${divider}px minmax(0,1fr) 0 0`
}

/** Subscribes to every signal that can accompany a fold change; returns an unsubscribe function. */
export function watchFoldState(listener: (state: FoldState) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  let current = readFoldState()
  const read = () => {
    const next = readFoldState()
    if (sameFoldState(current, next)) return
    current = next
    listener(next)
  }
  const queries = ['(horizontal-viewport-segments: 2)', '(vertical-viewport-segments: 2)']
    .map(query => { try { return window.matchMedia(query) } catch { return null } })
    .filter((query): query is MediaQueryList => !!query)
  window.addEventListener(FOLD_EVENT, read)
  window.addEventListener('resize', read)
  window.screen?.orientation?.addEventListener('change', read)
  queries.forEach(query => query.addEventListener('change', read))
  listener(current)
  return () => {
    window.removeEventListener(FOLD_EVENT, read)
    window.removeEventListener('resize', read)
    window.screen?.orientation?.removeEventListener('change', read)
    queries.forEach(query => query.removeEventListener('change', read))
  }
}
