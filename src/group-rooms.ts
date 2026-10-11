/**
 * Which gateway room belongs to which group.
 *
 * The app creates a room once, when the user creates the group, and the room id is
 * the only precise handle on it — matching by display name is ambiguous the moment a
 * group is ever re-created, because Hermes treats a same-name re-create as a fresh
 * room. So the id the app minted is remembered locally and used to address the room
 * from then on.
 */

const STORAGE_KEY = 'hermes-mobile-group-rooms'

export type RoomIdMap = Record<string, string>

/** Tolerant parse: a corrupt or unexpected payload yields no remembered rooms. */
export function parseRoomIds(raw: string | null): RoomIdMap {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: RoomIdMap = {}
    for (const [name, id] of Object.entries(parsed as Record<string, unknown>)) {
      if (name.trim() && typeof id === 'string' && id.trim()) out[name] = id.trim()
    }
    return out
  } catch { return {} }
}

/** Set (or, with a null id, clear) one group's room id without touching the rest. */
export function withRoomId(map: RoomIdMap, name: string, roomId: string | null): RoomIdMap {
  const next = { ...map }
  const key = name.trim()
  if (!key) return next
  if (roomId && roomId.trim()) next[key] = roomId.trim()
  else delete next[key]
  return next
}

/**
 * The room to read: the remembered id when the gateway still has it, otherwise a
 * room whose name matches — which covers a group created on another client.
 */
export function resolveRoom<T extends { room_id: string; name: string }>(
  rooms: T[], rememberedId: string | null | undefined, name: string,
): T | undefined {
  if (rememberedId) {
    const byId = rooms.find(room => room.room_id === rememberedId)
    if (byId) return byId
  }
  return rooms.find(room => room.name === name)
}

export function readRoomIds(): RoomIdMap {
  try { return parseRoomIds(localStorage.getItem(STORAGE_KEY)) } catch { return {} }
}

export function rememberRoomId(name: string, roomId: string): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(withRoomId(readRoomIds(), name, roomId))) } catch { /* storage unavailable */ }
}

export function forgetRoomId(name: string): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(withRoomId(readRoomIds(), name, null))) } catch { /* storage unavailable */ }
}
