import { describe, expect, it } from 'vitest'

import type { Capability, ProfileDetails } from './hermes'
import { capabilitiesChanged, capabilityCounts, filterCapabilities, toggleCapability } from './use-capabilities'

const cap = (name: string, enabled: boolean, extra: Partial<Capability> = {}): Capability => ({ name, enabled, ...extra })

describe('Bot capabilities', () => {
  it('toggles only the named capability and leaves the rest alone', () => {
    const items = [cap('browser', true), cap('terminal', false)]
    const next = toggleCapability(items, 'terminal')
    expect(next[1].enabled).toBe(true)
    expect(next[0].enabled).toBe(true)
    expect(items[1].enabled).toBe(false) // input is not mutated
  })

  it('ignores a name that is not present', () => {
    expect(toggleCapability([cap('browser', true)], 'nope')).toEqual([cap('browser', true)])
  })

  it('counts enabled capabilities', () => {
    expect(capabilityCounts([cap('a', true), cap('b', false), cap('c', true)])).toEqual({ enabled: 2, total: 3 })
    expect(capabilityCounts([])).toEqual({ enabled: 0, total: 0 })
  })

  it('filters on name, label and description, and returns everything for a blank query', () => {
    const items = [cap('web_search', true, { label: 'Web Search & Scraping' }), cap('terminal', false, { description: 'Shell access' })]
    expect(filterCapabilities(items, '')).toHaveLength(2)
    expect(filterCapabilities(items, '  ')).toHaveLength(2)
    expect(filterCapabilities(items, 'scraping').map(item => item.name)).toEqual(['web_search'])
    expect(filterCapabilities(items, 'shell').map(item => item.name)).toEqual(['terminal'])
  })

  it('reports changes only against loaded details, so a reload clears the Save affordance', () => {
    const details = { skills: [cap('browser', true)], toolsets: [] } as unknown as ProfileDetails
    expect(capabilitiesChanged([cap('browser', true)], [], details)).toBe(false)
    expect(capabilitiesChanged([cap('browser', false)], [], details)).toBe(true)
    // No details yet means nothing to compare against — never claim there are edits.
    expect(capabilitiesChanged([cap('browser', false)], [], null)).toBe(false)
  })
})
