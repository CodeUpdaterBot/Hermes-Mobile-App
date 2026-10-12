export type ActivitySession = { id: string; resolved_id?: string; preview?: string; last_active?: number; message_count?: number; title?: string }
export type RosterProfile = {
  name: string
  display_name?: string
  model?: string
  provider?: string
  description?: string
  has_avatar?: boolean
  ui_meta?: { 'hermes-bots'?: { color?: string; image?: string | null; imageKind?: string; shape?: string; groups?: string[]; group?: string } }
  canonical_session?: ActivitySession | null
  last_session?: ActivitySession | null
}
export type BotRow = { profile: RosterProfile; session: ActivitySession | null }

export function resolveCanonicalSessionId(session: ActivitySession): string {
  return session.resolved_id || session.id
}

export function buildBotRows(profiles: RosterProfile[]): BotRow[] {
  return profiles
    .map(profile => ({ profile, session: profile.canonical_session || null }))
    .sort((a, b) => (b.session?.last_active || 0) - (a.session?.last_active || 0))
}
