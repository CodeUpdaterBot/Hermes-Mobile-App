/**
 * A nudge channel for the notification sync.
 *
 * The shell re-posts notifications from an effect that watches the current turn, and a
 * permission grant changes nothing it can see. So a Bot that is already working would keep
 * waiting for its next state change before announcing itself, and a Bot that finished while
 * permission was denied would never be announced at all. The settings screen raises this after
 * a grant; the shell subscribes and re-runs its sync.
 *
 * Kept free of the Tauri bridge so it can be exercised in tests.
 */
type Listener = () => void

const listeners = new Set<Listener>()

/** @returns an unsubscribe function, so a component can drop it on unmount. */
export function onNotificationResync(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function requestNotificationResync(): void {
  for (const listener of listeners) listener()
}

/** Test-only: how many subscribers are attached, so a leak is visible. */
export function notificationResyncListenerCount(): number {
  return listeners.size
}
