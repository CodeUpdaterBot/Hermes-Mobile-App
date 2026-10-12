import { describe, expect, it } from 'vitest'

import { DEFAULT_WIDE_LAYOUT, parseWideLayout, readWideLayout, saveWideLayout, WIDE_LAYOUT_KEY, type WideLayout } from './wide-layout'

describe('wide layout defaults', () => {
  // The right column is a destination, not a default: the conversation gets the space until
  // the user asks for the pane, and the Bots rail stays because switching Bots is the job.
  it('hides the right column and keeps the Bots rail by default', () => {
    expect(DEFAULT_WIDE_LAYOUT.contextCollapsed).toBe(true)
    expect(DEFAULT_WIDE_LAYOUT.railCollapsed).toBe(false)
    expect(DEFAULT_WIDE_LAYOUT.railWidth).toBeNull()
    expect(DEFAULT_WIDE_LAYOUT.contextWidth).toBeNull()
  })

  it('falls back to the defaults for missing or corrupt content', () => {
    expect(parseWideLayout(null)).toEqual(DEFAULT_WIDE_LAYOUT)
    expect(parseWideLayout('not json')).toEqual(DEFAULT_WIDE_LAYOUT)
    expect(parseWideLayout('"a string"')).toEqual(DEFAULT_WIDE_LAYOUT)
    expect(parseWideLayout('[]')).toEqual(DEFAULT_WIDE_LAYOUT)
  })

  // A user's own choice must survive: expanding the pane is not undone by the default.
  it('restores an explicitly expanded right column', () => {
    expect(parseWideLayout(JSON.stringify({ contextCollapsed: false }))).toEqual({ ...DEFAULT_WIDE_LAYOUT, contextCollapsed: false })
  })

  it('restores dragged widths and collapsed columns', () => {
    const stored: WideLayout = { railWidth: 320, contextWidth: 264, railCollapsed: true, contextCollapsed: false }
    expect(parseWideLayout(JSON.stringify(stored))).toEqual(stored)
  })

  // One bad key must not throw away the rest of the layout, and a width can never exceed
  // what the divider is able to drag.
  it('recovers per field from a partial payload', () => {
    expect(parseWideLayout(JSON.stringify({ railWidth: 900, contextCollapsed: 'yes' }))).toEqual({
      ...DEFAULT_WIDE_LAYOUT,
      railWidth: 460,
    })
    expect(parseWideLayout(JSON.stringify({ railWidth: 12 }))).toEqual({ ...DEFAULT_WIDE_LAYOUT, railWidth: 180 })
    expect(parseWideLayout(JSON.stringify({ contextWidth: 10.6 }))).toEqual({ ...DEFAULT_WIDE_LAYOUT, contextWidth: 180 })
  })
})

describe('wide layout storage', () => {
  it('round-trips through a store', () => {
    const store = new Map<string, string>()
    const layout: WideLayout = { railWidth: 300, contextWidth: null, railCollapsed: false, contextCollapsed: true }
    saveWideLayout(layout, { setItem: (key, value) => void store.set(key, value) })
    expect(store.get(WIDE_LAYOUT_KEY)).toBe(JSON.stringify(layout))
    expect(readWideLayout({ getItem: key => store.get(key) ?? null })).toEqual(layout)
  })

  it('treats unavailable or throwing storage as no stored layout', () => {
    expect(readWideLayout(undefined)).toEqual(DEFAULT_WIDE_LAYOUT)
    expect(readWideLayout({ getItem: () => { throw new Error('SecurityError') } })).toEqual(DEFAULT_WIDE_LAYOUT)
    expect(() => saveWideLayout(DEFAULT_WIDE_LAYOUT, { setItem: () => { throw new Error('QuotaExceededError') } })).not.toThrow()
  })
})
