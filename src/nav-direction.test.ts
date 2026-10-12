import { describe, expect, it } from 'vitest'

import { NAV_DIRECTION_ATTRIBUTE, navDirectionFor, setNavDirection } from './nav-direction'

describe('navDirectionFor', () => {
  it('pushes forward when the user moves deeper', () => {
    expect(navDirectionFor(0, 1)).toBe('forward')
    expect(navDirectionFor(1, 2)).toBe('forward')
  })

  it('pops back when the user returns', () => {
    expect(navDirectionFor(1, 0)).toBe('back')
    expect(navDirectionFor(2, 1)).toBe('back')
    expect(navDirectionFor(2, 0)).toBe('back')
  })

  it('treats a lateral move as forward so switching tabs still animates in', () => {
    expect(navDirectionFor(1, 1)).toBe('forward')
  })

  it('treats the first render as forward', () => {
    expect(navDirectionFor(0, 0)).toBe('forward')
  })
})

describe('setNavDirection', () => {
  it('writes the direction to the root dataset under the documented attribute', () => {
    const root = { dataset: {} as Record<string, string> } as unknown as HTMLElement
    setNavDirection('back', root)
    expect(root.dataset[NAV_DIRECTION_ATTRIBUTE]).toBe('back')
    setNavDirection('forward', root)
    expect(root.dataset[NAV_DIRECTION_ATTRIBUTE]).toBe('forward')
  })

  it('is safe without a root element', () => {
    expect(() => setNavDirection('forward', null)).not.toThrow()
  })
})
