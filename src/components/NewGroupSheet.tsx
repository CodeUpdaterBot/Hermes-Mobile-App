import { useMemo, useState } from 'react'
import { Check, Plus, Search, Users, X } from 'lucide-react'

import type { RosterProfile } from '../live-model'
import { checkGroupSize, MAX_GROUP_MEMBERS, suggestGroupName } from '../groups'
import { BotAvatar } from './BotAvatar'

type Props = {
  profiles: RosterProfile[]
  busy?: boolean
  error?: string
  onClose: () => void
  onCreate: (name: string, members: RosterProfile[]) => void
}

/**
 * Pick 2–6 Bots, name the group, create it. Selection is the view's only state;
 * the room itself is opened by the caller so transport stays out of the view.
 */
export function NewGroupSheet({ profiles, busy = false, error = '', onClose, onCreate }: Props) {
  const [selected, setSelected] = useState<string[]>([])
  const [name, setName] = useState('')
  const [touchedName, setTouchedName] = useState(false)
  const [query, setQuery] = useState('')

  const chosen = useMemo(() => profiles.filter(profile => selected.includes(profile.name)), [profiles, selected])
  // Until the user names it themselves, offer the members' names so Create is one tap.
  const effectiveName = touchedName ? name : name || suggestGroupName(chosen)
  const size = checkGroupSize(selected.length)
  const full = selected.length >= MAX_GROUP_MEMBERS

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return profiles
    return profiles.filter(profile => `${profile.name} ${profile.display_name || ''}`.toLowerCase().includes(needle))
  }, [profiles, query])

  const toggle = (profileName: string) => {
    setSelected(current => current.includes(profileName)
      ? current.filter(item => item !== profileName)
      : current.length >= MAX_GROUP_MEMBERS ? current : [...current, profileName])
  }

  const canCreate = size.ok && effectiveName.trim().length > 0 && !busy

  return <main className="app management-sheet new-group">
    <header className="management-head">
      <button className="round-control" onClick={onClose} aria-label="Cancel new group"><X size={18}/></button>
      <b>New Group Chat</b>
      <span/>
    </header>

    <section className="new-group-body">
      <p className="new-group-intro">Pick {`2–${MAX_GROUP_MEMBERS}`} Bots to deliberate together. They keep their own models, memory and skills.</p>

      {chosen.length > 0 && <div className="new-group-chips">
        {chosen.map(profile => <span className="new-group-chip" key={profile.name}>
          <BotAvatar profile={profile} fallbackName={profile.name} variant="header"/>
          {profile.display_name || profile.name}
          <button onClick={() => toggle(profile.name)} aria-label={`Remove ${profile.name}`}><X size={12}/></button>
        </span>)}
      </div>}

      <div className="new-group-search"><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search bots to add…" aria-label="Search Bots"/></div>

      <div className="new-group-list" role="listbox" aria-label="Bots">
        {visible.length === 0 && <p className="management-empty">No Bots match “{query}”.</p>}
        {visible.map(profile => {
          const on = selected.includes(profile.name)
          const label = profile.display_name || profile.name
          return <button
            key={profile.name}
            role="option"
            aria-selected={on}
            className={`new-group-row${on ? ' selected' : ''}`}
            onClick={() => toggle(profile.name)}
            disabled={!on && full}
          >
            <BotAvatar profile={profile} fallbackName={profile.name} variant="roster"/>
            <span className="new-group-row-copy"><b>{label}</b><small>@{profile.name}</small></span>
            {on ? <span className="new-group-check"><Check size={14}/></span> : <span className="new-group-add"><Plus size={14}/></span>}
          </button>
        })}
      </div>

      {error && <p className="management-error">{error}</p>}
      {!size.ok && selected.length > 0 && <p className="new-group-hint">{size.reason}</p>}

      <label className="new-group-name">
        <span>Group name</span>
        <input value={effectiveName} onChange={event => { setTouchedName(true); setName(event.target.value) }} placeholder="Name this group" aria-label="Group name"/>
      </label>

      <div className="new-group-actions">
        <button className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="primary" disabled={!canCreate} onClick={() => onCreate(effectiveName.trim(), chosen)}>
          <Users size={16}/> {busy ? 'Creating…' : `Create Group${selected.length ? ` (${selected.length})` : ''}`}
        </button>
      </div>
    </section>
  </main>
}
