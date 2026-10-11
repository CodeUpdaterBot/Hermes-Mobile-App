import { describe, expect, it } from 'vitest'

import { parseRoomIds, resolveRoom, withRoomId } from './group-rooms'

describe('group room addressing', () => {
  it('tolerates corrupt or unexpected stored payloads', () => {
    expect(parseRoomIds(null)).toEqual({})
    expect(parseRoomIds('not json')).toEqual({})
    expect(parseRoomIds('[]')).toEqual({})
    expect(parseRoomIds('"x"')).toEqual({})
    expect(parseRoomIds('null')).toEqual({})
  })

  it('keeps only usable name -> id pairs', () => {
    expect(parseRoomIds(JSON.stringify({ 'Patcher, Signal': 'patcher-signal-1', '': 'x', nope: 3, '  ': 'y' })))
      .toEqual({ 'Patcher, Signal': 'patcher-signal-1' })
  })

  it('sets and clears one room id without disturbing the others', () => {
    const start = { A: 'a-1' }
    const added = withRoomId(start, 'B', 'b-1')
    expect(added).toEqual({ A: 'a-1', B: 'b-1' })
    expect(start).toEqual({ A: 'a-1' }) // input untouched
    expect(withRoomId(added, 'A', null)).toEqual({ B: 'b-1' })
    expect(withRoomId(added, '   ', 'x')).toEqual({ A: 'a-1', B: 'b-1' })
  })

  // Hermes treats a same-name re-create as a fresh room, so the remembered id must
  // win over the name or the app would read the wrong conversation.
  it('prefers the remembered id over a name match', () => {
    const rooms = [
      { room_id: 'patcher-signal-old', name: 'Patcher, Signal' },
      { room_id: 'patcher-signal-new', name: 'Patcher, Signal' },
    ]
    expect(resolveRoom(rooms, 'patcher-signal-new', 'Patcher, Signal')?.room_id).toBe('patcher-signal-new')
    // Falls back to the name when the remembered room is gone.
    expect(resolveRoom(rooms, 'missing', 'Patcher, Signal')?.room_id).toBe('patcher-signal-old')
    expect(resolveRoom(rooms, null, 'Other')).toBeUndefined()
  })
})
