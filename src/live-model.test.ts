import { describe, expect, it } from 'vitest'
import { buildBotRows, resolveCanonicalSessionId } from './live-model'

describe('live Hermes Bot roster', () => {
  it('uses each profile canonical Bot Chat, never its newest unrelated session', () => {
    const rows = buildBotRows([
      { name: 'gaetan', canonical_session: { id: 'bot', preview: 'Current Bot reply', last_active: 500 }, last_session: { id: 'cron', preview: 'Old cron text', last_active: 900 } },
      { name: 'hermes-mobile-app', canonical_session: { id: 'mobile', preview: 'Current user turn', last_active: 1000 }, last_session: { id: 'scratch', preview: 'Old scratch turn', last_active: 300 } },
    ])
    expect(rows.map(row => row.profile.name)).toEqual(['hermes-mobile-app', 'gaetan'])
    expect(rows[1].session?.preview).toBe('Current Bot reply')
    expect(rows[1].session?.id).toBe('bot')
  })

  it('uses the resolved persisted lineage tip for compressed canonical chat navigation', () => {
    expect(resolveCanonicalSessionId({ id: 'stored-bot-chat', resolved_id: 'lineage-tip-42' })).toBe('lineage-tip-42')
  })

  // The wide layout auto-opens rows[0] when the window widens on the Bots list, so
  // that the middle pane is a real conversation rather than a second roster. That
  // only means "most recent" while this ordering holds.
  it('orders rows by most recent activity so rows[0] is the Bot Chat the wide layout opens', () => {
    const rows = buildBotRows([
      { name: 'stale', canonical_session: { id: 'a', last_active: 100 } },
      { name: 'freshest', canonical_session: { id: 'b', last_active: 900 } },
      { name: 'middle', canonical_session: { id: 'c', last_active: 500 } },
    ])
    expect(rows.map(row => row.profile.name)).toEqual(['freshest', 'middle', 'stale'])
    expect(rows[0].session?.id).toBe('b')
  })
})
