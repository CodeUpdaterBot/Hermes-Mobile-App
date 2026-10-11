import { useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, RefreshCw, Search, Wrench } from 'lucide-react'

import { installHubSkill, searchHubSkills, type LiveProfile, type LiveSession, type SkillSearchResult } from '../hermes'
import { BotAvatar } from './BotAvatar'
import { CapabilityRow } from './CapabilityRow'
import { useEdgeSwipeBack } from '../edge-swipe'
import { filterCapabilities, useBotCapabilities } from '../use-capabilities'

type Props = { profile?: LiveProfile; session: LiveSession; onBack: () => void; onUpdated: () => void }
const titleize = (value: string) => value.split(/[-_]+/).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join(' ')

export function CapabilityManager({ profile, session, onBack, onUpdated }: Props) {
  const shellRef = useRef<HTMLElement>(null)
  useEdgeSwipeBack(shellRef, onBack)
  const caps = useBotCapabilities(session.profile)
  const [query, setQuery] = useState('')
  const [hubResults, setHubResults] = useState<SkillSearchResult[] | null>(null)
  const [installing, setInstalling] = useState('')
  const botName = profile?.display_name || titleize(session.profile)

  const visibleSkills = useMemo(() => filterCapabilities(caps.skills, query), [caps.skills, query])
  const visibleToolsets = useMemo(() => filterCapabilities(caps.toolsets, query), [caps.toolsets, query])

  const reload = async () => { setHubResults(null); await caps.reload() }
  const save = async () => { if (await caps.save()) onUpdated() }
  const searchHub = async () => {
    const value = query.trim(); if (!value) { setHubResults(null); return }
    caps.setError('')
    try { setHubResults(await searchHubSkills(session.profile, value)) }
    catch (reason) { caps.setError(reason instanceof Error ? reason.message : 'Could not search the Skills Hub.') }
  }
  const install = async (name: string) => {
    setInstalling(name); caps.setError('')
    try { await installHubSkill(session.profile, name); await caps.reload(); onUpdated() }
    catch (reason) { caps.setError(reason instanceof Error ? reason.message : `Could not install “${name}”.`) }
    finally { setInstalling('') }
  }

  return <main ref={shellRef} className="app management-sheet">
    <header className="management-head"><button className="round-control" onClick={onBack} aria-label="Back to Bot settings"><ArrowLeft size={18}/></button><b>Capabilities</b><button className="round-control" onClick={() => void reload()} aria-label="Refresh capabilities"><RefreshCw size={17}/></button></header>
    <section className="capability-context"><BotAvatar profile={profile} fallbackName={session.profile} variant="header"/><span><b>{botName}</b><small>Manage what this Bot can use</small></span></section>
    <div className="capability-search"><Search size={16}/><input value={query} onChange={event => { setQuery(event.target.value); setHubResults(null) }} onKeyDown={event => event.key === 'Enter' && void searchHub()} placeholder="Search installed skills or the Hub…"/><button disabled={!query.trim() || caps.loading} onClick={() => void searchHub()}>Search</button></div>
    {caps.error && <p className="management-error">{caps.error}</p>}
    {caps.changed && <button className="capability-save" disabled={caps.saving} onClick={() => void save()}>{caps.saving ? 'Saving…' : <><Check size={15}/> Save changes</>}</button>}
    {hubResults && <section className="capability-group"><div className="capability-group-head"><span>Skills Hub results</span><small>{hubResults.length}</small></div>{hubResults.length ? <div className="capability-list">{hubResults.map(item => <div className="capability-row" key={item.name}><Wrench size={17}/><span><b>{item.name}</b><small>{item.description || 'Installable Hermes skill'}</small></span>{caps.skills.some(skill => skill.name === item.name) ? <em>Installed</em> : <button className="capability-action" disabled={Boolean(installing)} onClick={() => void install(item.name)}>{installing === item.name ? 'Adding…' : 'Add'}</button>}</div>)}</div> : <p className="management-empty">No Skills Hub results matched “{query}”.</p>}</section>}
    <section className="capability-group"><div className="capability-group-head"><span>Installed skills</span><small>{caps.skillCounts.enabled}/{caps.skillCounts.total} enabled</small></div>{caps.loading && !caps.details ? <p className="management-empty">Loading capabilities…</p> : visibleSkills.length ? <div className="capability-list">{visibleSkills.map(item => <CapabilityRow item={item} key={item.name} onToggle={() => caps.toggleSkill(item.name)}/>)}</div> : <p className="management-empty">No installed skills match this search.</p>}</section>
    <section className="capability-group"><div className="capability-group-head"><span>Toolsets</span><small>{caps.toolsetCounts.enabled}/{caps.toolsetCounts.total} enabled</small></div><p className="capability-note">Toolset changes are saved to this Bot and apply to a new or reset conversation.</p>{visibleToolsets.length ? <div className="capability-list">{visibleToolsets.map(item => <CapabilityRow item={item} key={item.name} onToggle={() => caps.toggleToolset(item.name)}/>)}</div> : <p className="management-empty">No toolsets match this search.</p>}</section>
  </main>
}
