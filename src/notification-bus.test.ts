import { describe, expect, it, vi } from 'vitest'

import { notificationResyncListenerCount, onNotificationResync, requestNotificationResync } from './notification-bus'

describe('notification resync bus', () => {
  it('notifies every subscriber', () => {
    const first = vi.fn()
    const second = vi.fn()
    const offFirst = onNotificationResync(first)
    const offSecond = onNotificationResync(second)

    requestNotificationResync()

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    offFirst()
    offSecond()
  })

  // The shell subscribes once for the app's lifetime; a component that subscribes per mount
  // must not leak, or one grant would trigger an ever-growing number of syncs.
  it('stops calling an unsubscribed listener and does not leak it', () => {
    const before = notificationResyncListenerCount()
    const listener = vi.fn()
    const off = onNotificationResync(listener)
    expect(notificationResyncListenerCount()).toBe(before + 1)

    off()
    expect(notificationResyncListenerCount()).toBe(before)

    requestNotificationResync()
    expect(listener).not.toHaveBeenCalled()
  })
})
