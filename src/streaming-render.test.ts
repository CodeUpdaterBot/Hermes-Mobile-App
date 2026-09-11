import { describe, expect, it } from 'vitest'

import { areMessageCardPropsEqual } from './components/MarkdownContent'
import type { LiveMessage, LiveProfile } from './hermes'

type CardMessage = LiveMessage & { local?: boolean }

const message = (id: number): CardMessage => ({ id, role: 'assistant', content: 'hello world' })
const noopEdit = (value: string) => { void value }
const otherEdit = (value: string) => { void value }
const noopReveal = (id: number) => { void id }
const profile = (overrides: Partial<LiveProfile> = {}): LiveProfile => ({
  name: 'patch',
  display_name: 'Patch',
  model: 'test-model',
  has_avatar: false,
  ...overrides,
})
const propsOf = (overrides = {}) => ({
  message: message(1),
  onEdit: noopEdit,
  profile: profile(),
  fallbackName: 'patch',
  revealTimestamp: false,
  onRevealTimestamp: noopReveal,
  ...overrides,
})

describe('message card memo equality', () => {
  it('keeps identical prop refs from re-rendering during streaming', () => {
    const first = propsOf()
    expect(areMessageCardPropsEqual(first, { ...first })).toBe(true)
  })

  it('re-renders when the message object is replaced', () => {
    const first = propsOf()
    expect(areMessageCardPropsEqual(first, { ...first, message: message(1) })).toBe(false)
  })

  it('ignores non-rendered profile fields that change on every background refresh', () => {
    const first = propsOf()
    const refreshed = {
      ...first,
      profile: profile({ model: 'other-model', description: 'new description' }),
    }
    expect(areMessageCardPropsEqual(first, refreshed)).toBe(true)
  })

  it('re-renders when rendered profile fields change', () => {
    const first = propsOf()
    const renamed = { ...first, profile: profile({ display_name: 'New name' }) }
    expect(areMessageCardPropsEqual(first, renamed)).toBe(false)
  })

  it('re-renders when the timestamp reveal toggles or callbacks change', () => {
    const first = propsOf()
    expect(areMessageCardPropsEqual(first, { ...first, revealTimestamp: true })).toBe(false)
    expect(areMessageCardPropsEqual(first, { ...first, onEdit: otherEdit })).toBe(false)
  })
})
