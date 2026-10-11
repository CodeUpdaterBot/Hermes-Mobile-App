import type { RosterProfile } from './live-model'

// Group membership lives in each Bot's backend-synced profile metadata
// (`ui_meta['hermes-bots']`), which the roster the app already loads carries — so
// discovery needs no extra RPC and a group is visible on any client that can see
// its members. Verified against a live profile written by Hermes Desktop:
//   ui_meta: { 'hermes-bots': { groups: ['Patcher, Signal'], group: 'Patcher, Signal' } }

export const MIN_GROUP_MEMBERS = 2
export const MAX_GROUP_MEMBERS = 6

export type BotGroup = { name: string; members: string[] }

/**
 * The group names one Bot belongs to. The live shape is `groups: string[]`; older
 * profiles carry a single legacy `group: string`, and a profile can have both, so
 * both keys are read and the result is de-duplicated.
 */
export function groupNamesOf(profile: RosterProfile): string[] {
  const meta = profile.ui_meta?.['hermes-bots']
  if (!meta) return []
  const raw = [...(Array.isArray(meta.groups) ? meta.groups : []), ...(meta.group ? [meta.group] : [])]
  const seen = new Set<string>()
  const names: string[] = []
  for (const value of raw) {
    const name = typeof value === 'string' ? value.trim() : ''
    if (!name || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

/**
 * Every group across the roster, with its member profile names. A group exists
 * exactly as long as some Bot claims it, so a Bot leaving simply shrinks the list
 * and the last Bot leaving removes it — no separate group record to drift.
 *
 * Ordered by name: the metadata carries no activity timestamp, and inventing a
 * recency order for groups would sort them differently on every client.
 */
export function groupsFromProfiles(profiles: RosterProfile[]): BotGroup[] {
  const byName = new Map<string, string[]>()
  for (const profile of profiles) {
    for (const name of groupNamesOf(profile)) {
      const members = byName.get(name)
      if (!members) { byName.set(name, [profile.name]); continue }
      if (!members.includes(profile.name)) members.push(profile.name)
    }
  }
  return [...byName.entries()]
    .map(([name, members]) => ({ name, members }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.members.length - b.members.length)
}

/** Group names as a Bot's own profile metadata would store them. */
export function groupsToWrite(names: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of names) {
    const name = value.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

export type GroupSizeCheck = { ok: true } | { ok: false; reason: string }

/**
 * A room is a discussion between Bots, so one Bot is not a group; and the picker
 * is deliberately capped so a group stays a legible conversation.
 */
export function checkGroupSize(count: number): GroupSizeCheck {
  if (count < MIN_GROUP_MEMBERS) {
    return { ok: false, reason: `Pick at least ${MIN_GROUP_MEMBERS} Bots — a group is a discussion between Bots.` }
  }
  if (count > MAX_GROUP_MEMBERS) {
    return { ok: false, reason: `Pick at most ${MAX_GROUP_MEMBERS} Bots for one group.` }
  }
  return { ok: true }
}

/**
 * A room id is client-chosen and creation is idempotent, so the caller generates it
 * once per create attempt and reuses it on retry. A fresh suffix per creation keeps
 * a deliberate same-name re-create from colliding with the room it replaces.
 */
export function newGroupRoomId(name: string, suffix = Math.random().toString(36).slice(2, 8)): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'group'
  return `${slug}-${suffix}`
}

/** The name a new group is offered by default, from the Bots it will contain. */
export function suggestGroupName(profiles: RosterProfile[]): string {
  return profiles
    .map(profile => profile.display_name || profile.name)
    .filter(Boolean)
    .join(', ')
    .slice(0, 80)
}
