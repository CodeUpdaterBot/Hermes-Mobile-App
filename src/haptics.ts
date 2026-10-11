/**
 * Native-feel tactile feedback for Hermes Mobile.
 *
 * Hermes Mobile runs in a Tauri WebView, so there is no platform haptic API to
 * call the way a Kotlin/Swift app would. The Android WebView still exposes the
 * standard vibration service, which is what `navigator.vibrate` drives. The
 * packaged app therefore declares `android.permission.VIBRATE`; on any surface
 * without a vibration service (desktop, iOS WebView) every call degrades to a
 * silent no-op.
 *
 * Feedback is deliberately centralised in one capture-phase listener instead of
 * being sprinkled through each component: every control in the app inherits the
 * correct tactile response from the class it already uses, and removing the
 * listener disables haptics everywhere at once.
 */

export type HapticKind = 'tap' | 'select' | 'impact' | 'success' | 'warning'

/** Milliseconds or a vibrate/off pattern, matching `navigator.vibrate`. */
export const HAPTIC_PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 8,
  select: 12,
  impact: 18,
  success: [12, 44, 20],
  warning: [26, 70, 26],
}

/** Committed actions get a firmer pulse than navigation. */
export const HAPTIC_IMPACT_SELECTORS = [
  '.primary',
  '.composer-send',
  '.task-trigger',
  '.pairing-signin',
  '.pairing-test',
  '.task-delete-modal .delete',
  '.task-delete-icon',
  '.voice-trigger',
  '.latest-button',
] as const

/** Discrete choices get a crisper tick than a generic tap. */
export const HAPTIC_SELECT_SELECTORS = [
  '.tabs button',
  '.theme-picker button',
  '.menu-list button',
  '.model-option',
  '.chips button',
  '.model-list button',
  '.reasoning-popover button',
  '.mention-popover button',
  '.slash-popover button',
  '.appearance-grid button',
  '.capability-toggle',
  '.task-toggle',
] as const

/**
 * Ordered selector resolution. `match` is injected so the decision stays a pure
 * function that can be unit tested without a DOM.
 */
export function hapticKindFor(match: (selector: string) => boolean): HapticKind {
  for (const selector of HAPTIC_IMPACT_SELECTORS) if (match(selector)) return 'impact'
  for (const selector of HAPTIC_SELECT_SELECTORS) if (match(selector)) return 'select'
  return 'tap'
}

export function hapticPattern(kind: HapticKind): number | number[] {
  return HAPTIC_PATTERNS[kind]
}

/** Rate limit so a fast scroll over list rows cannot buzz continuously. */
export const HAPTIC_MIN_GAP_MS = 36

export function shouldEmitHaptic(now: number, lastEmittedAt: number, gap = HAPTIC_MIN_GAP_MS): boolean {
  return now - lastEmittedAt >= gap
}

export const HAPTIC_PREFERENCE_KEY = 'hermes-mobile-haptics'

type StorageLike = { getItem(key: string): string | null }

/** Opt-out preference; haptics stay on unless the user explicitly disables them. */
export function hapticsEnabled(storage?: StorageLike | null): boolean {
  if (!storage) return true
  try {
    return storage.getItem(HAPTIC_PREFERENCE_KEY) !== 'off'
  } catch {
    return true
  }
}

const INTERACTIVE_SELECTOR = 'button,[role="button"],a[href],.bot-row,.task-card,[data-haptic]'
const TEXT_ENTRY_SELECTOR = 'textarea,input,[contenteditable="true"]'
const OPT_OUT_SELECTOR = '[data-no-haptic],[disabled],[aria-disabled="true"]'

function vibrationService(): ((pattern: number | number[]) => boolean) | null {
  if (typeof navigator === 'undefined') return null
  const vibrate = (navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean }).vibrate
  if (typeof vibrate !== 'function') return null
  return vibrate.bind(navigator)
}

/** Fire one explicit tactile response. Safe to call on any platform. */
export function haptic(kind: HapticKind = 'tap'): void {
  const vibrate = vibrationService()
  if (!vibrate) return
  if (!hapticsEnabled(typeof localStorage === 'undefined' ? null : localStorage)) return
  try {
    vibrate(hapticPattern(kind))
  } catch {
    /* A blocked vibration service must never break an interaction. */
  }
}

export type HapticInstallOptions = {
  /** Override the vibration clock, used by tests. */
  now?: () => number
  gapMs?: number
}

/**
 * Attach the single global feedback listener. Returns an uninstall function.
 */
export function installHapticFeedback(options: HapticInstallOptions = {}): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  if (!vibrationService()) return () => {}
  if (!hapticsEnabled(typeof localStorage === 'undefined' ? null : localStorage)) return () => {}

  const now = options.now ?? (() => performance.now())
  const gap = options.gapMs ?? HAPTIC_MIN_GAP_MS
  let lastEmittedAt = Number.NEGATIVE_INFINITY

  const onPointerDown = (event: Event) => {
    const target = event.target as Element | null
    if (!target || typeof target.closest !== 'function') return
    if (target.closest(TEXT_ENTRY_SELECTOR)) return
    const control = target.closest(INTERACTIVE_SELECTOR)
    if (!control) return
    if (control.closest(OPT_OUT_SELECTOR)) return
    if (control.hasAttribute('disabled') || control.getAttribute('aria-disabled') === 'true') return

    const stamp = now()
    if (!shouldEmitHaptic(stamp, lastEmittedAt, gap)) return
    lastEmittedAt = stamp
    haptic(hapticKindFor(selector => control.matches(selector)))
  }

  document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })
  return () => document.removeEventListener('pointerdown', onPointerDown, { capture: true })
}
