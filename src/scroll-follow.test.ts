import { describe, expect, it } from 'vitest'

import { SCROLL_FOLLOW_THRESHOLD, shouldStickToBottom } from './scroll-follow'

describe('shouldStickToBottom', () => {
  it('sticks when pinned to the bottom', () => {
    expect(shouldStickToBottom(1000, 800, 200)).toBe(true)
  })

  it('sticks within the default 120px threshold', () => {
    expect(shouldStickToBottom(1000, 681, 200)).toBe(true)
  })

  it('stops sticking when scrolled up past the threshold', () => {
    expect(shouldStickToBottom(1000, 679, 200)).toBe(false)
  })

  it('treats exactly-threshold distance as scrolled up (matches < check)', () => {
    expect(shouldStickToBottom(1000, 680, 200)).toBe(false)
  })

  it('honours a custom threshold', () => {
    expect(shouldStickToBottom(1000, 700, 200, 50)).toBe(false)
    expect(shouldStickToBottom(1000, 760, 200, 50)).toBe(true)
  })

  it('exposes the default threshold used by ChatView', () => {
    expect(SCROLL_FOLLOW_THRESHOLD).toBe(120)
  })
})
