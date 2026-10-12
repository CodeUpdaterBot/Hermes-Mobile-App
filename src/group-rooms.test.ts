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

  // A room's name is whatever string created it, and group identity is case-insensitive
  // everywhere else — so a roster spelling the group differently must still find the room
  // rather than opening (or minting) a second, empty one.
  it('matches a room name case-insensitively', () => {
    const rooms = [{ room_id: 'r1', name: 'patcher, research-rabbit', latest_seq: 8 }]
    expect(resolveRoom(rooms, null, 'Patcher, Research Rabbit')?.room_id).toBe('r1')
  })

  // The blank-group-chat case: a stale empty room that shares the name must never win over
  // the room that actually holds the conversation.
  it('prefers the room holding history over an empty lookalike', () => {
    const rooms = [
      { room_id: 'empty', name: 'Patcher, Research Rabbit', latest_seq: 1 },
      { room_id: 'history', name: 'patcher, research-rabbit', latest_seq: 8 },
    ]
    expect(resolveRoom(rooms, 'empty', 'Patcher, Research Rabbit')?.room_id).toBe('history')
  })

  // The id derived from the name is exactly what `groups.create` would mint, so it still
  // addresses the room when nothing was remembered and the name has drifted.
  it('finds the room by its derived id', () => {
    const rooms = [{ room_id: 'derived-1', name: 'something else', latest_seq: 4 }]
    expect(resolveRoom(rooms, null, 'Patcher', 'derived-1')?.room_id).toBe('derived-1')
  })

  // …but a remembered room that really holds the conversation stays authoritative, even
  // when another room shares its name.
  it('keeps a remembered room that holds history', () => {
    const rooms = [
      { room_id: 'mine', name: 'Patcher, Signal', latest_seq: 12 },
      { room_id: 'other', name: 'Patcher, Signal', latest_seq: 40 },
    ]
    expect(resolveRoom(rooms, 'mine', 'Patcher, Signal')?.room_id).toBe('mine')
  })
})
