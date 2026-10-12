import { useCallback, useEffect, useState } from 'react'

import { loadProfileDetails, setProfileCapabilities, type Capability, type ProfileDetails } from './hermes'

// One source of truth for a Bot's Skills and Toolsets. Both the full Capabilities
// screen and the wide layout's sidebar section read it, so they cannot disagree
// about what is enabled or what a toggle means.

export function toggleCapability(items: Capability[], name: string): Capability[] {
  return items.map(item => item.name === name ? { ...item, enabled: !item.enabled } : item)
}

export function capabilityCounts(items: Capability[]): { enabled: number; total: number } {
  return { enabled: items.filter(item => item.enabled).length, total: items.length }
}

export function filterCapabilities(items: Capability[], query: string): Capability[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return items
  return items.filter(item => `${item.name} ${item.label || ''} ${item.description || ''}`.toLowerCase().includes(needle))
}

/** Only unsaved edits count as changed: reloading must clear the Save affordance. */
export function capabilitiesChanged(skills: Capability[], toolsets: Capability[], details: ProfileDetails | null): boolean {
  if (!details) return false
  return JSON.stringify(skills) !== JSON.stringify(details.skills || [])
    || JSON.stringify(toolsets) !== JSON.stringify(details.toolsets || [])
}

export function useBotCapabilities(profile: string) {
  const [details, setDetails] = useState<ProfileDetails | null>(null)
  const [skills, setSkills] = useState<Capability[]>([])
  const [toolsets, setToolsets] = useState<Capability[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const next = await loadProfileDetails(profile)
      setDetails(next)
      setSkills(next.skills || [])
      setToolsets(next.toolsets || [])
      return next
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load this Bot’s capabilities.')
      return null
    } finally { setLoading(false) }
  }, [profile])

  useEffect(() => { void reload() }, [reload])

  const save = useCallback(async () => {
    setSaving(true); setError('')
    try {
      await setProfileCapabilities(profile, skills, toolsets)
      await reload()
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save these capability settings.')
      return false
    } finally { setSaving(false) }
  }, [profile, skills, toolsets, reload])

  return {
    details, skills, toolsets, loading, saving, error, setError, reload, save,
    changed: capabilitiesChanged(skills, toolsets, details),
    skillCounts: capabilityCounts(skills),
    toolsetCounts: capabilityCounts(toolsets),
    toggleSkill: (name: string) => setSkills(items => toggleCapability(items, name)),
    toggleToolset: (name: string) => setToolsets(items => toggleCapability(items, name)),
    discard: () => { setSkills(details?.skills || []); setToolsets(details?.toolsets || []) },
  }
}
