import { useMemo, useState } from 'react'
import { Check, ChevronRight, RefreshCw, Search, Wrench } from 'lucide-react'

import { filterCapabilities, useBotCapabilities } from '../use-capabilities'
import { CapabilityRow } from './CapabilityRow'

type Props = { profileName: string; onOpenSettings: () => void; onUpdated: () => void }

/**
 * The Bot's Skills and Toolsets, rendered for the wide layout's right column.
 * It reads the same hook as the full Capabilities screen, so the two can never
 * disagree about what is enabled. Hub search/install stays in the full screen —
 * this is the at-a-glance and quick-toggle view.
 */
export function BotCapabilities({ profileName, onOpenSettings, onUpdated }: Props) {
  const caps = useBotCapabilities(profileName)
  const [query, setQuery] = useState('')

  const visibleSkills = useMemo(() => filterCapabilities(caps.skills, query), [caps.skills, query])
  const visibleToolsets = useMemo(() => filterCapabilities(caps.toolsets, query), [caps.toolsets, query])

  const save = async () => { if (await caps.save()) onUpdated() }

  return <section className="sidebar-caps" aria-label={`${profileName} capabilities`}>
    <header className="sidebar-caps-head">
      <span className="profile-section-label"><Wrench size={13}/> Capabilities</span>
      <span className="sidebar-caps-actions">
        <button onClick={() => void caps.reload()} aria-label="Refresh capabilities"><RefreshCw size={14}/></button>
        <button onClick={onOpenSettings} aria-label="Open Bot settings"><ChevronRight size={15}/></button>
      </span>
    </header>

    <div className="capability-search sidebar"><Search size={15}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search skills & toolsets…" aria-label="Search skills and toolsets"/></div>

    {caps.error && <p className="management-error">{caps.error}</p>}
    {caps.changed && <button className="capability-save sidebar" disabled={caps.saving} onClick={() => void save()}>{caps.saving ? 'Saving…' : <><Check size={14}/> Save changes</>}</button>}

    {caps.loading && !caps.details
      ? <p className="management-empty">Loading capabilities…</p>
      : <>
        <div className="capability-group-head"><span>Installed skills</span><small>{caps.skillCounts.enabled}/{caps.skillCounts.total} enabled</small></div>
        {visibleSkills.length
          ? <div className="capability-list">{visibleSkills.map(item => <CapabilityRow item={item} key={item.name} onToggle={() => caps.toggleSkill(item.name)}/>)}</div>
          : <p className="management-empty">No installed skills match this search.</p>}

        <div className="capability-group-head"><span>Toolsets</span><small>{caps.toolsetCounts.enabled}/{caps.toolsetCounts.total} enabled</small></div>
        <p className="capability-note">Saved to this Bot — applies to a new or reset conversation.</p>
        {visibleToolsets.length
          ? <div className="capability-list">{visibleToolsets.map(item => <CapabilityRow item={item} key={item.name} onToggle={() => caps.toggleToolset(item.name)}/>)}</div>
          : <p className="management-empty">No toolsets match this search.</p>}
      </>}
  </section>
}
