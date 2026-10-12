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

/**
 * A room name reduced to what actually identifies the room.
 *
 * Casing is only half the story: the roster builds display names with `titleize`, which
 * turns the profile `research-rabbit` into `Research Rabbit`, while the room was created
 * from the hyphenated string. So `patcher, research-rabbit` and `Patcher, Research Rabbit`
 * are the same room and must reduce to the same key — case, punctuation and separator runs
 * all collapse.
 */
export function roomNameKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

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
 * The room to read: the remembered id when the gateway still has it, otherwise the room
 * that actually belongs to this group.
 *
 * Group identity is effectively case- and separator-insensitive (`roomNameKey`), but a room's
 * name is whatever string created it — so matching on the literal name opened a *second,
 * empty* room whenever a roster reported the group differently (the roster titleizes display
 * names, turning `research-rabbit` into `Research Rabbit`), leaving the conversation behind in
 * the room nobody addressed. Resolution therefore tries, in order:
 *
 *   1. the remembered id (the only precise handle on the room the user has been using);
 *   2. the id derived deterministically from the group name (what `groups.create` would mint);
 *   3. any room whose name matches case-insensitively.
 *
 * Among the candidates it keeps the room with the most history, so a stale empty lookalike
 * can never win over the room that holds the conversation — the "blank group chat" case.
 * A remembered room that already holds history always stays authoritative.
 */
export function resolveRoom<T extends { room_id: string; name: string; latest_seq?: number | null }>(
  rooms: T[], rememberedId: string | null | undefined, name: string, derivedId?: string | null,
): T | undefined {
  const activity = (room: T) => (typeof room.latest_seq === 'number' ? room.latest_seq : 0)
  const remembered = rememberedId ? rooms.find(room => room.room_id === rememberedId) : undefined
  if (remembered && activity(remembered) > 1) return remembered
  const key = roomNameKey(name)
  const candidates = [
    ...(remembered ? [remembered] : []),
    ...(derivedId ? rooms.filter(room => room.room_id === derivedId) : []),
    ...rooms.filter(room => roomNameKey(room.name) === key),
  ]
  if (!candidates.length) return undefined
  const seen = new Set<string>()
  return candidates
    .filter(room => (seen.has(room.room_id) ? false : (seen.add(room.room_id), true)))
    .sort((a, b) => activity(b) - activity(a))[0]
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
