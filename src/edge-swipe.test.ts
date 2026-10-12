import { describe, expect, it } from 'vitest'

import {
  EDGE_SWIPE_COMMIT_PX,
  EDGE_SWIPE_MAX_OFFSET_PX,
  EDGE_SWIPE_TRACKING_RATIO,
  edgeSwipeOffset,
  shouldCommitEdgeSwipe,
} from './edge-swipe'

describe('edge swipe back', () => {
  it('commits a deliberate horizontal gesture', () => {
    expect(shouldCommitEdgeSwipe(EDGE_SWIPE_COMMIT_PX, 10)).toBe(true)
  })

  it('does not steal a mostly vertical scroll', () => {
    expect(shouldCommitEdgeSwipe(120, 110)).toBe(false)
  })

  it('does not commit a short edge drag', () => {
    expect(shouldCommitEdgeSwipe(EDGE_SWIPE_COMMIT_PX - 1, 0)).toBe(false)
  })
})

describe('edgeSwipeOffset', () => {
  it('tracks the finger 1:1 so the gesture feels attached to the screen', () => {
    expect(EDGE_SWIPE_TRACKING_RATIO).toBe(1)
    expect(edgeSwipeOffset(40, 400)).toBe(40)
    expect(edgeSwipeOffset(120, 400)).toBe(120)
  })

  it('never returns a negative offset for a leftward drag', () => {
    expect(edgeSwipeOffset(-80, 400)).toBe(0)
  })

  it('caps the drag at the smaller of the ceiling and the viewport', () => {
    expect(edgeSwipeOffset(2000, 300)).toBeLessThanOrEqual(300 + 24)
    expect(edgeSwipeOffset(2000, 900)).toBeLessThanOrEqual(EDGE_SWIPE_MAX_OFFSET_PX + 24)
  })

  it('rubber-bands only slightly past the ceiling instead of running away', () => {
    const atCeiling = edgeSwipeOffset(400, 400)
    const wellPast = edgeSwipeOffset(4000, 400)
    expect(wellPast).toBeGreaterThan(atCeiling)
    expect(wellPast - atCeiling).toBeLessThanOrEqual(24)
  })

  it('keeps the commit threshold well inside the draggable distance', () => {
    expect(EDGE_SWIPE_COMMIT_PX).toBeLessThan(edgeSwipeOffset(EDGE_SWIPE_COMMIT_PX + 1, 400))
  })
})
