import { describe, expect, it } from 'vitest'

import type { RosterProfile } from './live-model'
import { checkGroupSize, groupNamesOf, groupsFromProfiles, groupsToWrite, newGroupRoomId, suggestGroupName } from './groups'

const bot = (name: string, meta?: Record<string, unknown>): RosterProfile => ({
  name,
  ui_meta: meta ? { 'hermes-bots': meta as never } : undefined,
})

describe('Bot groups', () => {
  it('reads the live array shape and the legacy singular key, de-duplicated', () => {
    // Exactly what Hermes Desktop writes for a two-Bot room.
    expect(groupNamesOf(bot('patcher', { groups: ['Patcher, Signal'], group: 'Patcher, Signal' }))).toEqual(['Patcher, Signal'])
    expect(groupNamesOf(bot('legacy', { group: 'Old Room' }))).toEqual(['Old Room'])
    expect(groupNamesOf(bot('none'))).toEqual([])
    expect(groupNamesOf(bot('blank', { groups: ['', '   '] }))).toEqual([])
  })

  it('trims and drops duplicate names within one profile', () => {
    expect(groupNamesOf(bot('x', { groups: [' Room ', 'Room', 'Other'] }))).toEqual(['Room', 'Other'])
  })

  it('builds groups from membership, so a group lives exactly as long as a Bot claims it', () => {
    const groups = groupsFromProfiles([
      bot('patcher', { groups: ['Patcher, Signal'] }),
      bot('signal', { groups: ['Patcher, Signal', 'Trio'] }),
      bot('gaetan', { groups: ['Trio'] }),
    ])
    expect(groups.map(g => g.name)).toEqual(['Patcher, Signal', 'Trio'])
    expect(groups[0].members).toEqual(['patcher', 'signal'])
    expect(groups[1].members).toEqual(['signal', 'gaetan'])
  })

  it('lists a Bot once even when both metadata keys name the same group', () => {
    const groups = groupsFromProfiles([bot('patcher', { groups: ['Room'], group: 'Room' })])
    expect(groups).toHaveLength(1)
    expect(groups[0].members).toEqual(['patcher'])
  })

  it('returns no groups for an empty roster and orders by name, not by discovery order', () => {
    expect(groupsFromProfiles([])).toEqual([])
    const groups = groupsFromProfiles([bot('a', { groups: ['Zulu'] }), bot('b', { groups: ['Alpha'] })])
    expect(groups.map(g => g.name)).toEqual(['Alpha', 'Zulu'])
  })

  it('requires 2..6 Bots', () => {
    expect(checkGroupSize(0).ok).toBe(false)
    expect(checkGroupSize(1).ok).toBe(false)
    expect(checkGroupSize(2).ok).toBe(true)
    expect(checkGroupSize(6).ok).toBe(true)
    const tooMany = checkGroupSize(7)
    expect(tooMany.ok).toBe(false)
    if (!tooMany.ok) expect(tooMany.reason).toContain('at most')
  })

  it('keeps a written group list trimmed and unique', () => {
    expect(groupsToWrite([' Room ', 'Room', '', 'Other'])).toEqual(['Room', 'Other'])
  })

  it('generates an identifier-safe room id, unique per create attempt', () => {
    const id = newGroupRoomId('Patcher, Signal')
    expect(id).toMatch(/^[a-z0-9][a-z0-9-]*$/)
    expect(id.startsWith('patcher-signal-')).toBe(true)
    expect(newGroupRoomId('Patcher, Signal')).not.toBe(id) // fresh room per deliberate re-create
    expect(newGroupRoomId('!!!')).toMatch(/^group-[a-z0-9]+$/)
  })

  it('suggests a name from the chosen Bots', () => {
    expect(suggestGroupName([bot('patcher'), bot('signal')])).toBe('patcher, signal')
  })
})
