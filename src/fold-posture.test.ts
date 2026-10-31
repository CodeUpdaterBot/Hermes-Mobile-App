import { describe, expect, it } from 'vitest'

import { applyFoldState, bookColumns, FLAT, readFoldState, resolveFoldState, sameFoldState, stateFromNative, stateFromSegments } from './fold-posture'
import { isWideViewport } from './wide-layout'

describe('wide viewport on foldables', () => {
  it.each([
    ['Galaxy Z Fold7 unfolded portrait', 984, 1092, true],
    ['Galaxy Z Fold7 unfolded landscape', 1092, 984, true],
    ['Galaxy Z Fold7 unfolded, large Screen zoom', 820, 910, true],
    ['iPhone Duo unfolded portrait', 626, 890, true],
    ['iPhone Duo unfolded landscape', 890, 626, true],
    ['Galaxy Z Fold7 cover screen', 412, 960, false],
    ['iPhone Duo cover screen', 466, 678, false],
    ['Ordinary phone portrait', 430, 932, false],
    ['Ordinary phone landscape', 852, 393, false],
    ['Tablet landscape', 1180, 820, true],
  ])('%s (%dx%d) → wide=%s', (_name, width, height, wide) => {
    expect(isWideViewport(width, height)).toBe(wide)
  })
})

describe('fold posture from viewport segments', () => {
  it('is flat without exactly two valid segments', () => {
    expect(stateFromSegments(undefined)).toEqual(FLAT)
    expect(stateFromSegments([{ x: 0, y: 0, width: 984, height: 1092 }])).toEqual(FLAT)
    expect(stateFromSegments([{ x: 0, y: 0, width: 1, height: 1 }, { nope: true }])).toEqual(FLAT)
  })

  it('reads side-by-side segments as book posture with the hinge between them', () => {
    const state = stateFromSegments([{ x: 500, y: 0, width: 484, height: 1092 }, { x: 0, y: 0, width: 484, height: 1092 }])
    expect(state).toEqual({ posture: 'book', hinge: { x: 484, y: 0, width: 16, height: 1092 } })
  })

  it('reads stacked segments as tabletop posture', () => {
    const state = stateFromSegments([{ x: 0, y: 0, width: 1092, height: 480 }, { x: 0, y: 500, width: 1092, height: 484 }])
    expect(state).toEqual({ posture: 'tabletop', hinge: { x: 0, y: 480, width: 1092, height: 20 } })
  })
})

describe('fold posture from the Android FoldingFeature bridge', () => {
  const bounds = { x: 492, y: 0, width: 0, height: 1092 }

  it('treats a fully opened, non-separating fold as one flat display', () => {
    expect(stateFromNative({ state: 'flat', orientation: 'vertical', separating: false, bounds })).toEqual(FLAT)
  })

  it('maps half-opened vertical and horizontal folds', () => {
    expect(stateFromNative({ state: 'half_opened', orientation: 'vertical', separating: false, bounds })).toEqual({ posture: 'book', hinge: bounds })
    expect(stateFromNative({ state: 'half_opened', orientation: 'horizontal', separating: false, bounds: { x: 0, y: 492, width: 1092, height: 0 } }).posture).toBe('tabletop')
  })

  it('rejects malformed payloads', () => {
    expect(stateFromNative(null)).toEqual(FLAT)
    expect(stateFromNative({ state: 'half_opened', orientation: 'vertical' })).toEqual(FLAT)
    expect(stateFromNative({ state: 'half_opened', orientation: 'diagonal', bounds })).toEqual(FLAT)
  })

  it('prefers a native report over segments, even a flat one', () => {
    const segments = [{ x: 0, y: 0, width: 484, height: 1092 }, { x: 500, y: 0, width: 484, height: 1092 }]
    expect(resolveFoldState(null, segments)).toEqual(FLAT)
    expect(resolveFoldState(undefined, segments).posture).toBe('book')
  })

  it('reads the bridge and segments from a window-like object', () => {
    expect(readFoldState({ __HERMES_FOLD__: { state: 'half_opened', orientation: 'vertical', separating: false, bounds } }).posture).toBe('book')
    expect(readFoldState({ viewport: { segments: null } })).toEqual(FLAT)
    expect(readFoldState(undefined)).toEqual(FLAT)
  })

  it('reads the reload-safe JavascriptInterface when no state was pushed yet', () => {
    const bridge = { state: () => JSON.stringify({ state: 'half_opened', orientation: 'horizontal', separating: false, bounds: { x: 0, y: 490, width: 1092, height: 0 } }) }
    expect(readFoldState({ HermesFoldBridge: bridge }).posture).toBe('tabletop')
    expect(readFoldState({ HermesFoldBridge: { state: () => 'not json' } })).toEqual(FLAT)
    expect(readFoldState({ HermesFoldBridge: { state: () => 'null' } })).toEqual(FLAT)
  })
})

describe('book posture columns', () => {
  it('centres the divider on a zero-width hinge', () => {
    expect(bookColumns({ x: 492, y: 0, width: 0, height: 1092 }, 984)).toBe('489px 7px minmax(0,1fr) 0 0')
  })

  it('uses the physical hinge width when it is wider than the divider', () => {
    expect(bookColumns({ x: 484, y: 0, width: 16, height: 1092 }, 1000)).toBe('484px 16px minmax(0,1fr) 0 0')
  })

  it('declines a hinge that leaves a page too narrow', () => {
    expect(bookColumns({ x: 120, y: 0, width: 0, height: 900 }, 900)).toBeNull()
    expect(bookColumns({ x: 500, y: 0, width: 0, height: 900 }, 700)).toBeNull()
  })
})

describe('fold state helpers', () => {
  it('compares states by value', () => {
    expect(sameFoldState(FLAT, { posture: 'flat', hinge: null })).toBe(true)
    expect(sameFoldState({ posture: 'book', hinge: { x: 1, y: 0, width: 0, height: 9 } }, { posture: 'book', hinge: { x: 2, y: 0, width: 0, height: 9 } })).toBe(false)
  })

  it('writes the posture and hinge variables to the root and clears them when flat', () => {
    const props = new Map<string, string>()
    const root = { dataset: {} as Record<string, string>, style: { setProperty: (k: string, v: string) => void props.set(k, v), removeProperty: (k: string) => void props.delete(k) } }
    applyFoldState({ posture: 'tabletop', hinge: { x: 0, y: 480.4, width: 1092, height: 20 } }, root as unknown as HTMLElement)
    expect(root.dataset.posture).toBe('tabletop')
    expect(props.get('--hinge-y')).toBe('480px')
    applyFoldState(FLAT, root as unknown as HTMLElement)
    expect(root.dataset.posture).toBe('flat')
    expect(props.size).toBe(0)
  })
})
