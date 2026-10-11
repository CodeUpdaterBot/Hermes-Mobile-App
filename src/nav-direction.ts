/**
 * Directional screen transitions.
 *
 * Tauri renders every screen as a plain React subtree swap, so nothing tells the
 * browser whether the user moved deeper into the app or came back out. Tracking
 * a screen depth lets the motion layer play a forward "push in" or a back "pop
 * in" instead of an ambiguous fade — the difference between a web app and a
 * native one.
 */

export type NavDirection = 'forward' | 'back'

export const NAV_DIRECTION_ATTRIBUTE = 'nav'

/**
 * Depth 0 is the roster root, 1 is a pushed screen (chat, settings, tasks,
 * wizard) and 2+ is a screen presented on top of another (Bot settings,
 * capabilities).
 */
export function navDirectionFor(previousDepth: number, nextDepth: number): NavDirection {
  return nextDepth < previousDepth ? 'back' : 'forward'
}

export function setNavDirection(
  direction: NavDirection,
  root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement,
): void {
  if (!root) return
  root.dataset[NAV_DIRECTION_ATTRIBUTE] = direction
}
