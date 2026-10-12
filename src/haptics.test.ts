import { describe, expect, it } from 'vitest'

import {
  HAPTIC_MIN_GAP_MS,
  HAPTIC_PATTERNS,
  HAPTIC_PREFERENCE_KEY,
  hapticKindFor,
  hapticPattern,
  hapticsEnabled,
  setHapticsEnabled,
  shouldEmitHaptic,
} from './haptics'

const matcher = (...selectors: string[]) => (selector: string) => selectors.includes(selector)

describe('hapticKindFor', () => {
  it('resolves committed primary actions to an impact pulse', () => {
    expect(hapticKindFor(matcher('.primary'))).toBe('impact')
    expect(hapticKindFor(matcher('.composer-send'))).toBe('impact')
    expect(hapticKindFor(matcher('.task-trigger'))).toBe('impact')
  })

  it('resolves discrete choices to a select tick', () => {
    expect(hapticKindFor(matcher('.tabs button'))).toBe('select')
    expect(hapticKindFor(matcher('.theme-picker button'))).toBe('select')
    expect(hapticKindFor(matcher('.model-option'))).toBe('select')
  })

  it('prefers impact when an element matches both families', () => {
    expect(hapticKindFor(matcher('.tabs button', '.primary'))).toBe('impact')
  })

  it('falls back to a plain tap for everything else', () => {
    expect(hapticKindFor(() => false)).toBe('tap')
    expect(hapticKindFor(matcher('.something-else'))).toBe('tap')
  })
})

describe('haptic patterns', () => {
  it('exposes a pattern for every kind', () => {
    for (const kind of ['tap', 'select', 'impact', 'success', 'warning'] as const) {
      expect(hapticPattern(kind)).toBe(HAPTIC_PATTERNS[kind])
    }
  })

  it('keeps the plain tap short so list scrolling stays quiet', () => {
    expect(HAPTIC_PATTERNS.tap).toBeLessThanOrEqual(10)
  })
})

describe('shouldEmitHaptic', () => {
  it('emits on the first interaction regardless of clock origin', () => {
    expect(shouldEmitHaptic(0, Number.NEGATIVE_INFINITY)).toBe(true)
  })

  it('suppresses a second pulse inside the gap', () => {
    expect(shouldEmitHaptic(100, 100 - (HAPTIC_MIN_GAP_MS - 1))).toBe(false)
  })

  it('allows a pulse once the gap has elapsed', () => {
    expect(shouldEmitHaptic(100, 100 - HAPTIC_MIN_GAP_MS)).toBe(true)
  })

  it('honours a custom gap', () => {
    expect(shouldEmitHaptic(100, 90, 5)).toBe(true)
    expect(shouldEmitHaptic(100, 99, 5)).toBe(false)
  })
})

describe('hapticsEnabled', () => {
  it('defaults to on when no storage is available', () => {
    expect(hapticsEnabled(null)).toBe(true)
  })

  it('stays on for any value other than the explicit opt-out', () => {
    expect(hapticsEnabled({ getItem: () => null })).toBe(true)
    expect(hapticsEnabled({ getItem: () => 'on' })).toBe(true)
  })

  it('disables only for the explicit opt-out', () => {
    expect(hapticsEnabled({ getItem: () => 'off' })).toBe(false)
  })

  it('survives a storage that throws', () => {
    expect(hapticsEnabled({ getItem: () => { throw new Error('blocked') } })).toBe(true)
  })
})

describe('setHapticsEnabled', () => {
  const fakeStorage = () => {
    const values = new Map<string, string>()
    return {
      values,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    }
  }

  it('writes the opt-out the reader looks for', () => {
    const storage = fakeStorage()
    setHapticsEnabled(false, storage)
    expect(storage.values.get(HAPTIC_PREFERENCE_KEY)).toBe('off')
    expect(hapticsEnabled(storage)).toBe(false)
  })

  it('round-trips back to enabled', () => {
    const storage = fakeStorage()
    setHapticsEnabled(false, storage)
    setHapticsEnabled(true, storage)
    expect(hapticsEnabled(storage)).toBe(true)
  })

  it('never throws when storage is missing or blocked', () => {
    expect(() => setHapticsEnabled(false, null)).not.toThrow()
    expect(() => setHapticsEnabled(false, { getItem: () => null, setItem: () => { throw new Error('blocked') } })).not.toThrow()
  })
})
