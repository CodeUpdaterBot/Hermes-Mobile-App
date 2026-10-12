import { afterEach, describe, expect, it, vi } from 'vitest'

import { withDeadline } from './deadline'

describe('withDeadline', () => {
  afterEach(() => { vi.useRealTimers() })

  it('passes through the answer when it arrives in time', async () => {
    await expect(withDeadline(Promise.resolve({ granted: true }), 1000)).resolves.toEqual({ granted: true })
  })

  // The whole reason this exists: a lost native callback must end the wait instead of hanging
  // the screen on a request that is no longer being answered.
  it('resolves null once the deadline passes with no answer', async () => {
    vi.useFakeTimers()
    const pending = withDeadline(new Promise<{ granted: boolean } | null>(() => {}), 30_000)
    await vi.advanceTimersByTimeAsync(30_001)
    await expect(pending).resolves.toBeNull()
  })

  it('treats a rejected native call as no answer rather than an error', async () => {
    await expect(withDeadline(Promise.reject(new Error('bridge gone')), 1000)).resolves.toBeNull()
  })

  it('leaves no timer behind when the answer wins the race', async () => {
    vi.useFakeTimers()
    const pending = withDeadline(Promise.resolve({ granted: false }), 30_000)
    await vi.advanceTimersByTimeAsync(0)
    await expect(pending).resolves.toEqual({ granted: false })
    expect(vi.getTimerCount()).toBe(0)
  })
})
