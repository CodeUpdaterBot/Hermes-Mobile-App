import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, RefreshCw, Search, Settings as SettingsIcon, Users, X } from 'lucide-react'

import { ChatView } from './components/ChatView'
import { BotAvatar } from './components/BotAvatar'
import { BotAppearancePicker } from './components/BotAppearancePicker'
import { BotProfileSheet } from './components/BotProfileSheet'
import { TasksView } from './components/TasksView'
import { ConnectionSettings } from './components/ConnectionSettings'
import { onBackButtonPress } from '@tauri-apps/api/app'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { flushSync } from 'react-dom'
import { buildAttachmentPrompt, attachmentSummary } from './attachment-routing'
import { buildBotRows, resolveCanonicalSessionId } from './live-model'
import { settleAssistantResponse, type SettledAssistantResponse as SettledAssistantState } from './settled-assistant'
import { isActiveChatTurn } from './chat-turn'
import { errorMessage, RequestEpoch, selectRestoredEndpoint } from './connection-state'
import { connectAndSubmit, createProfile, interruptSession, loadMessages, loadSnapshot, savedHermesEndpoint, setActiveHermesEndpoint, type LiveMessage, type LiveProfile, type LiveSession, type LiveUsage } from './hermes'

type Tab = 'bots' | 'sessions' | 'tasks'
type DraftBot = { role: string; name: string; description: string; soul: string; model: string; provider: string; shape: string }
type Theme = 'dark' | 'light' | 'grey' | 'aurora'
type SettledAssistantResponse = { sessionId: string; profile: string; content: string; usage?: LiveUsage }
export type ToolActivity = { id: string; name: string; status: 'running' | 'done' | 'failed'; duration_s?: number; summary?: string }

const titleize = (value: string) => value.split(/[-_]+/).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join(' ')
const ago = (seconds?: number) => {
  if (!seconds) return ''
  const delta = Math.max(0, Date.now() / 1000 - seconds)
  if (delta < 75) return 'now'
  if (delta < 3600) return `${Math.floor(delta / 60)}m`
  if (delta < 86400) return `${Math.floor(delta / 3600)}h`
  if (delta < 604800) return `${Math.floor(delta / 86400)}d`
  return `${Math.floor(delta / 604800)}w`
}

const roles: Record<string, [string, string]> = {
  Researcher: ['research-rabbit', 'Digs into questions and returns sourced answers.'],
  Coder: ['patch', 'Writes, reviews, and ships code.'],
  Writer: ['draft', 'Turns ideas into clear, vivid writing.'],
  Analyst: ['signal', 'Finds patterns and explains what matters.'],
  Custom: ['', ''],
}

export default function App() {
  const [tab, setTab] = useState<Tab>('bots')
  const [profiles, setProfiles] = useState<LiveProfile[]>([])
  const [sessions, setSessions] = useState<LiveSession[]>([])
  const [selected, setSelected] = useState<LiveSession | null>(null)
  const selectedRef = useRef<LiveSession | null>(selected)
  selectedRef.current = selected
  const chatTurnGenerationRef = useRef(0)
  const [conversationLoading, setConversationLoading] = useState(false)
  const sessionLoadRef = useRef(0)
  const [profileSheet, setProfileSheet] = useState(false)
  const [messages, setMessages] = useState<LiveMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeEndpoint, setActiveEndpoint] = useState(() => selectRestoredEndpoint(null, localStorage.getItem('hermes-mobile-active-endpoint'), 'http://127.0.0.1:9119'))
  const activeEndpointRef = useRef(activeEndpoint)
  const refreshEpochRef = useRef(new RequestEpoch())
  const refreshInFlightRef = useRef(false)
  const [, setPairingBusy] = useState(false)
  const pairingBusyRef = useRef(false)
  const setPairingBusyState = (busy: boolean) => { pairingBusyRef.current = busy; setPairingBusy(busy) }
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking')
  const lastConnectionErrorRef = useRef('')
  const [streaming, setStreaming] = useState('')
  const [settledAssistant, setSettledAssistant] = useState<SettledAssistantState | null>(null)
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(sending)
  sendingRef.current = sending
  const [toolActivities, setToolActivities] = useState<ToolActivity[]>([])
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [settings, setSettings] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createStep, setCreateStep] = useState(0)
  const [creating, setCreating] = useState(false)
  const [botDraft, setBotDraft] = useState<DraftBot>({
    role: 'Coder', name: 'patch', description: 'Writes, reviews, and ships code.',
    soul: 'You are a pragmatic software engineer. Read surrounding code before changing it, keep diffs focused, and verify your work by running it.',
    model: '', provider: '', shape: 'blobatar',
  })
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('hermes-mobile-theme') as Theme | null) || 'dark')
  const [rosterPullDistance, setRosterPullDistance] = useState(0)
  const [rosterPullRefreshing, setRosterPullRefreshing] = useState(false)
  const rosterScrollRef = useRef<HTMLDivElement | null>(null)
  const rosterPullStartRef = useRef<number | null>(null)

  const navigationRef = useRef({ selected: false, profileSheet: false, settings: false, createOpen: false, tab: 'bots' as Tab })
  navigationRef.current = { selected: Boolean(selected), profileSheet, settings, createOpen, tab }

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    let unlistenAndroidBack: { unregister: () => Promise<void> } | undefined
    const handleBack = async () => {
      const backEvent = new Event('hermes-mobile-back', { cancelable: true })
      window.dispatchEvent(backEvent)
      if (backEvent.defaultPrevented) return true
      const navigation = navigationRef.current
      if (navigation.profileSheet) { setProfileSheet(false); return true }
      if (navigation.selected) { setSelected(null); return true }
      if (navigation.settings) { setSettings(false); return true }
      if (navigation.createOpen) { setCreateOpen(false); return true }
      if (navigation.tab !== 'bots') { setTab('bots'); return true }
      return false
    }
    void getCurrentWindow().onCloseRequested(async event => {
      if (await handleBack()) event.preventDefault()
    }).then(remove => { if (disposed) remove(); else unlisten = remove }).catch(() => {})
    void onBackButtonPress(async () => {
      if (!(await handleBack()) && !disposed) await getCurrentWindow().close()
    }).then(listener => { if (disposed) void listener.unregister(); else unlistenAndroidBack = listener }).catch(() => {})
    return () => { disposed = true; unlisten?.(); void unlistenAndroidBack?.unregister() }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('hermes-mobile-theme', theme)
  }, [theme])
  const activateEndpoint = (endpoint: string) => {
    const normalized = endpoint.replace(/\/$/, '')
    activeEndpointRef.current = normalized
    setActiveHermesEndpoint(normalized)
    setActiveEndpoint(normalized)
    return normalized
  }
  const refresh = async (requestedEndpoint = activeEndpointRef.current, supersede = false): Promise<{ profiles: LiveProfile[]; sessions: LiveSession[] } | null> => {
    if ((pairingBusyRef.current || refreshInFlightRef.current) && !supersede) return null
    const endpoint = requestedEndpoint.replace(/\/$/, '')
    const epoch = refreshEpochRef.current.begin()
    refreshInFlightRef.current = true
    setLoading(true)
    if (supersede) setConnectionStatus('checking')
    try {
      const data = await loadSnapshot(endpoint)
      if (!refreshEpochRef.current.isCurrent(epoch)) return null
      setProfiles(data.profiles)
      setSessions(data.sessions)
      setError('')
      lastConnectionErrorRef.current = ''
      setConnectionStatus('connected')
      return data
    } catch (reason) {
      if (refreshEpochRef.current.isCurrent(epoch)) {
        const message = errorMessage(reason, 'Could not connect to Hermes Desktop.')
        lastConnectionErrorRef.current = message
        setError(message)
        setConnectionStatus('disconnected')
      }
      return null
    } finally {
      if (refreshEpochRef.current.isCurrent(epoch)) {
        refreshInFlightRef.current = false
        setLoading(false)
      }
    }
  }
  const pullRefreshRoster = async () => {
    setRosterPullRefreshing(true)
    try { await refresh() } finally { setRosterPullRefreshing(false) }
  }

  useEffect(() => {
    let active = true
    let timer: number | undefined
    const bootstrap = async () => {
      let nativeEndpoint: string | null = null
      try { nativeEndpoint = await savedHermesEndpoint() }
      catch (reason) { if (active) setError(errorMessage(reason, 'Could not restore the saved Hermes host.')) }
      if (!active) return
      const endpoint = activateEndpoint(selectRestoredEndpoint(nativeEndpoint, localStorage.getItem('hermes-mobile-active-endpoint'), 'http://127.0.0.1:9119'))
      await refresh(endpoint, true)
      if (active) timer = window.setInterval(() => {
        if (document.hidden || sendingRef.current) return
        void refresh(activeEndpointRef.current)
      }, 5_000)
    }
    void bootstrap()
    return () => { active = false; if (timer) window.clearInterval(timer); refreshEpochRef.current.begin() }
  }, [])

  useEffect(() => {
    const resumeSavedConnection = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const saved = await savedHermesEndpoint()
        if (!saved) return
        const endpoint = activateEndpoint(saved)
        await refresh(endpoint, true)
      } catch (reason) {
        const message = errorMessage(reason, 'Could not restore the saved Hermes host.')
        lastConnectionErrorRef.current = message
        setError(message)
        setConnectionStatus('disconnected')
      }
    }
    document.addEventListener('visibilitychange', resumeSavedConnection)
    return () => document.removeEventListener('visibilitychange', resumeSavedConnection)
  }, [])

  const rows = useMemo(() => buildBotRows(profiles).map(({ profile, session }) => ({
    profile,
    session: session ? {
      id: resolveCanonicalSessionId(session),
      title: profile.display_name || titleize(profile.name),
      preview: session.preview || '',
      profile: profile.name,
      model: profile.model,
      last_active: session.last_active,
      unread: false,
    } satisfies LiveSession : null,
  })).filter(row => `${row.profile.name} ${row.profile.display_name || ''} ${row.session?.preview || ''}`.toLowerCase().includes(query.toLowerCase())), [profiles, query])

  const visibleSessions = useMemo(() => sessions.filter(session => `${session.title} ${session.profile} ${session.preview}`.toLowerCase().includes(query.toLowerCase())), [sessions, query])
  const mentions = useMemo(() => profiles.filter(profile => (`@${profile.name}`).includes((draft.match(/@[\w-]*$/)?.[0] || '').toLowerCase())), [profiles, draft])

  const openSession = (session: LiveSession, latestUsage?: LiveUsage): Promise<void> => {
    const requestId = ++sessionLoadRef.current
    const turnId = ++chatTurnGenerationRef.current
    const startedAt = performance.now()
    flushSync(() => {
      setSelected(session)
      setProfileSheet(false)
      setMessages([])
      setSettledAssistant(null)
      setError('')
      setSending(false)
      setStreaming('')
      setToolActivities([])
      setConversationLoading(true)
    })
    return (async () => {
      try {
        const loaded = await loadMessages(session.id, session.profile)
        if (requestId !== sessionLoadRef.current || turnId !== chatTurnGenerationRef.current) return
        const latestAssistant = latestUsage ? [...loaded].reverse().findIndex(message => message.role === 'assistant') : -1
        setMessages(latestAssistant >= 0 ? loaded.map((message, index) => index === loaded.length - latestAssistant - 1 ? { ...message, usage: latestUsage } : message) : loaded)
      }
      catch (reason) {
        if (requestId === sessionLoadRef.current && turnId === chatTurnGenerationRef.current) setError(reason instanceof Error ? reason.message : 'Could not load this Hermes conversation.')
      }
      finally {
        const remaining = Math.max(0, 700 - (performance.now() - startedAt))
        if (remaining) await new Promise(resolve => window.setTimeout(resolve, remaining))
        if (requestId === sessionLoadRef.current && turnId === chatTurnGenerationRef.current) setConversationLoading(false)
      }
    })()
  }

  const submit = async (attachmentRefs: { name: string; refText: string }[] = [], voiceText?: string): Promise<boolean> => {
    if (!selected || sending) return false
    const turnId = ++chatTurnGenerationRef.current
    const turnSession = { id: selected.id, profile: selected.profile }
    const isCurrentTurn = () => isActiveChatTurn(turnId, chatTurnGenerationRef.current, turnSession, selectedRef.current)
    const text = (voiceText ?? draft).trim()
    if (!text && !attachmentRefs.length) return false
    const prompt = buildAttachmentPrompt(text, attachmentRefs)
    let completionUsage: LiveUsage | undefined
    let finalText = ''
    const priorSettled = settledAssistant?.sessionId === selected.id && settledAssistant.profile === selected.profile ? settledAssistant : null
    const priorAssistantMessage = priorSettled ? { id: -(Date.now() + 1), role: 'assistant' as const, content: priorSettled.content, usage: priorSettled.usage } : null
    const localUserMessage = { id: -Date.now(), role: 'user' as const, content: attachmentSummary(text, attachmentRefs) }
    if (voiceText === undefined) setDraft('')
    setSettledAssistant(null)
    setError('')
    setSending(true)
    setStreaming('')
    setToolActivities([])
    setMessages(items => [...items, ...(priorAssistantMessage ? [priorAssistantMessage] : []), localUserMessage])
    try {
      await connectAndSubmit(selected.id, selected.profile, prompt, (type, payload) => {
        if (!isCurrentTurn()) return
        if (type === 'message.delta') {
          finalText += String(payload.text || '')
          setStreaming(finalText)
        }
        if (type === 'message.complete') {
          finalText = String(payload.text || finalText)
          setStreaming(finalText)
          completionUsage = payload.usage && typeof payload.usage === 'object' ? payload.usage as LiveUsage : undefined
        }
        if (type === 'tool.start') setToolActivities(items => {
          const id = String(payload.tool_id || payload.name || `tool-${items.length}`)
          return [...items.filter(item => item.id !== id), { id, name: String(payload.name || 'tool'), status: 'running', summary: typeof payload.context === 'string' ? payload.context : undefined }]
        })
        if (type === 'tool.complete') setToolActivities(items => {
          const id = String(payload.tool_id || payload.name || `tool-${items.length}`)
          return [...items.filter(item => item.id !== id), { id, name: String(payload.name || 'tool'), status: 'done', duration_s: typeof payload.duration_s === 'number' ? payload.duration_s : undefined, summary: typeof payload.summary === 'string' ? payload.summary : undefined }]
        })
        if (type === 'error') setError(String(payload.message || 'Hermes could not complete that request.'))
      })
      if (!isCurrentTurn()) return false
      const terminalAssistant = settleAssistantResponse(selected.id, selected.profile, finalText, completionUsage)
      if (terminalAssistant) {
        setSettledAssistant(terminalAssistant)
        setSending(false)
        setStreaming('')
      } else {
        await openSession(selected, completionUsage)
      }
      await refresh()
      return true
    } catch (reason) {
      if (isCurrentTurn()) setError(reason instanceof Error ? reason.message : 'Could not send to Hermes.')
      return false
    } finally {
      if (isCurrentTurn()) {
        setSending(false)
        setStreaming('')
      }
    }
  }

  const stop = async () => {
    if (!selected || !sending) return
    try { await interruptSession(selected.id) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not stop this Hermes turn.') }
  }

  const finishCreate = async () => {
    setCreating(true)
    setError('')
    try {
      await createProfile(botDraft)
      setCreateOpen(false)
      setCreateStep(0)
      const data = await refresh()
      const createdProfile = data?.profiles.find(profile => profile.name === botDraft.name)
      const canonical = createdProfile?.canonical_session
      if (createdProfile && canonical) {
        await openSession({
          id: resolveCanonicalSessionId(canonical),
          title: createdProfile.display_name || titleize(createdProfile.name),
          preview: canonical.preview || '',
          profile: createdProfile.name,
          model: createdProfile.model,
          last_active: canonical.last_active,
          unread: false,
        })
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create this Bot.')
    } finally { setCreating(false) }
  }

  const rosterPullActive = rosterPullDistance > 8 || rosterPullRefreshing
  const rosterTouchStart = (event: React.TouchEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('input,textarea') || rosterScrollRef.current?.scrollTop !== 0) return
    rosterPullStartRef.current = event.touches[0].clientY
  }
  const rosterTouchMove = (event: React.TouchEvent<HTMLElement>) => {
    if (rosterPullStartRef.current == null || rosterScrollRef.current?.scrollTop !== 0) return
    const distance = Math.min(76, Math.max(0, event.touches[0].clientY - rosterPullStartRef.current))
    if (distance > 0) event.preventDefault()
    setRosterPullDistance(distance)
  }
  const rosterTouchEnd = () => {
    const shouldRefresh = rosterPullDistance >= 56
    rosterPullStartRef.current = null
    setRosterPullDistance(0)
    if (shouldRefresh) void pullRefreshRoster()
  }

  if (createOpen) return <CreateWizard step={createStep} setStep={setCreateStep} draft={botDraft} setDraft={setBotDraft} creating={creating} error={error} close={() => { setCreateOpen(false); setCreateStep(0); setError('') }} finish={() => void finishCreate()}/>
  if (settings) return <ConnectionSettings profiles={profiles.length} sessions={sessions.length} connected={connectionStatus === 'connected'} endpoint={activeEndpoint !== 'http://127.0.0.1:9119' ? activeEndpoint : undefined} theme={theme} setTheme={setTheme} close={() => setSettings(false)} refresh={() => refresh()} onPairingBusy={setPairingBusyState} onPaired={async endpoint => { const normalized = activateEndpoint(endpoint); const data = await refresh(normalized, true); if (!data) throw new Error(lastConnectionErrorRef.current || 'Signed in, but authenticated Hermes REST or live WebSocket verification failed.'); localStorage.setItem('hermes-mobile-active-endpoint', normalized) }}/>
  if (selected && profileSheet) return <BotProfileSheet profile={profiles.find(profile => profile.name === selected.profile)} session={selected} onClose={() => setProfileSheet(false)} onUpdated={() => void refresh()}/>
  if (selected) return <ChatView session={selected} conversationLoading={conversationLoading} messages={messages} settledAssistant={settledAssistant?.sessionId === selected.id && settledAssistant.profile === selected.profile ? settledAssistant : null} profiles={profiles} draft={draft} setDraft={setDraft} mentions={mentions} streaming={streaming} sending={sending} toolActivities={toolActivities} error={error} back={() => setSelected(null)} refresh={() => void openSession(selected)} openProfile={() => setProfileSheet(true)} onSessionModelChange={model => setSelected(current => current ? { ...current, model } : current)} submit={submit} submitVoice={text => submit([], text)} stop={() => void stop()}/>
  if (tab === 'tasks') return <TasksView back={() => setTab('bots')} profiles={profiles}/>

  return <main className="app roster-shell">
    <div className="roster-pinned">
      <header className="roster-head"><div><h1>{tab === 'bots' ? 'Bots' : 'Sessions'}</h1><span className={`connection ${connectionStatus === 'disconnected' ? 'offline' : connectionStatus === 'connected' ? 'online' : 'checking'}`} title={connectionStatus === 'disconnected' ? 'No Hermes detected. Start Hermes Desktop, then retry.' : connectionStatus === 'connected' ? 'Connected to Hermes Desktop' : 'Checking for Hermes Desktop…'} aria-label={connectionStatus === 'disconnected' ? 'Hermes Desktop unavailable' : connectionStatus === 'connected' ? 'Connected to Hermes Desktop' : 'Checking for Hermes Desktop'}><i className="connection-dot"/><span>{connectionStatus === 'disconnected' ? 'Hermes unavailable' : connectionStatus === 'connected' ? 'Hermes Desktop' : 'Checking…'}</span></span></div><div className="header-actions"><button className="icon-button" aria-label="Search" onClick={() => setSearching(value => !value)}><Search size={18}/></button><button className="icon-button" aria-label="Settings" onClick={() => setSettings(true)}><SettingsIcon size={18}/></button></div></header>
      {searching && <div className="search"><Search size={16}/><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={tab === 'bots' ? 'Search bots and group chats…' : 'Search sessions…'}/><button onClick={() => { setQuery(''); setSearching(false) }}><X size={16}/></button></div>}
      <nav className="tabs"><button className={tab === 'bots' ? 'active' : ''} onClick={() => setTab('bots')}>Bots</button><button className={tab === 'sessions' ? 'active' : ''} onClick={() => setTab('sessions')}>Sessions</button><button onClick={() => setTab('tasks')}>Tasks</button></nav>
    </div>
    <div className="roster-list-scroll" ref={rosterScrollRef} onTouchStart={rosterTouchStart} onTouchMove={rosterTouchMove} onTouchEnd={rosterTouchEnd}>
      {rosterPullActive && <div className="roster-pull-cue" style={{ height: `${rosterPullRefreshing ? 46 : rosterPullDistance}px` }}><RefreshCw size={15} className={rosterPullRefreshing ? 'pull-refresh-spinner' : ''}/><span>{rosterPullRefreshing ? 'Refreshing…' : rosterPullDistance >= 56 ? 'Release to refresh' : 'Pull to refresh'}</span></div>}
      {error && <Notice message={error} retry={() => void refresh()}/>}
      {loading && !profiles.length ? <Skeleton/> : tab === 'bots' ? <section className="bot-list">{rows.map(({ profile, session }, index) => <button className="bot-row enter" style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }} key={profile.name} disabled={!session} onClick={() => session && void openSession(session)}><BotAvatar profile={profile} fallbackName={profile.name}/><span className="bot-copy"><b>{profile.display_name || titleize(profile.name)}</b><small>{session?.preview || profile.description || 'No messages yet'} </small></span><span className="meta">{ago(session?.last_active)}{session && <i className={session.unread ? 'unread' : ''}/>}</span></button>)}</section> : <section className="bot-list">{visibleSessions.map((session, index) => <button className="bot-row enter" style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }} key={`${session.profile}:${session.id}`} onClick={() => void openSession(session)}><BotAvatar profile={profiles.find(profile => profile.name === session.profile)} fallbackName={session.profile} variant="session"/><span className="bot-copy"><b>{session.title || 'Untitled session'}</b><small>{titleize(session.profile)} · {session.preview}</small></span><span className="meta">{ago(session.last_active)}</span></button>)}</section>}
    </div>
    <footer className="roster-actions">{tab === 'bots' ? <><button className="secondary" disabled title="Group-room transport is not yet enabled"><Users size={16}/> New group</button><button className="primary" onClick={() => setCreateOpen(true)}><Plus size={16}/> New Bot</button></> : <button className="primary wide" onClick={() => setTab('bots')}>Back to Bots</button>}</footer>
  </main>
}

function Notice({ message, retry }: { message: string; retry: () => void }) {
  return <div className="notice"><b>Connection needs attention</b><span>{message}</span><button onClick={retry}>Try again</button></div>
}
function Skeleton() { return <div className="skeletons">{[1, 2, 3, 4, 5, 6].map(item => <i key={item}/>)}</div> }

function LegacyConnectionSettings({ profiles, sessions, theme, setTheme, close, refresh }: { profiles: number; sessions: number; theme: Theme; setTheme: (theme: Theme) => void; close: () => void; refresh: () => void }) {
  const [showThemes, setShowThemes] = useState(false)
  const themes: Array<{ id: Theme; label: string; description: string }> = [
    { id: 'dark', label: 'OLED dark', description: 'Deep black with violet accents' },
    { id: 'light', label: 'Light', description: 'Bright canvas with soft blue accents' },
    { id: 'grey', label: 'Graphite', description: 'Neutral grey with cool surfaces' },
    { id: 'aurora', label: 'Aurora', description: 'Midnight navy with teal-violet glow' },
  ]
  return <main className="app panel"><header className="panel-head"><button className="back-button" onClick={close}>‹</button><div><h2>Connection</h2><p>Hermes Desktop host</p></div></header><section className="connection-card"><span className="status-pill">● Connected</span><h3>This Windows PC</h3><code>127.0.0.1:9119</code><div className="stats"><span><b>{profiles}</b>Bots</span><span><b>{sessions}</b>Sessions</span></div><button className="primary wide" onClick={refresh}>Sync now</button></section><section className="menu-list"><button>Notifications <span>›</span></button><button onClick={() => setShowThemes(value => !value)}>Appearance <span>{themes.find(item => item.id === theme)?.label} ›</span></button>{showThemes && <div className="theme-picker">{themes.map(item => <button className={item.id === theme ? 'selected' : ''} onClick={() => setTheme(item.id)} key={item.id}><span className={`theme-swatch theme-${item.id}`}/><span><b>{item.label}</b><small>{item.description}</small></span><i>{item.id === theme ? '✓' : ''}</i></button>)}</div>}<button>Security & pairing <span>›</span></button><button>About Hermes Mobile <span>0.1.0 ›</span></button></section><p className="fine">The host owns models, credentials, tools, memory, skills, and approvals. This client is the control surface.</p></main>
}

function CreateWizard({ step, setStep, draft, setDraft, creating, error, close, finish }: { step: number; setStep: (step: number) => void; draft: DraftBot; setDraft: React.Dispatch<React.SetStateAction<DraftBot>>; creating: boolean; error: string; close: () => void; finish: () => void }) {
  const titles = ['Who is this bot?', 'Personality', 'Model', 'Look']
  useEffect(() => {
    const onMobileBack = (event: Event) => {
      event.preventDefault()
      if (step > 0) setStep(step - 1)
      else close()
    }
    window.addEventListener('hermes-mobile-back', onMobileBack)
    return () => window.removeEventListener('hermes-mobile-back', onMobileBack)
  }, [close, setStep, step])
  const pickRole = (role: string) => { const [name, description] = roles[role]; setDraft(current => ({ ...current, role, name, description })) }
  return <main className="app wizard"><header><button className="icon-button" onClick={close}><X size={18}/></button><div className="progress">{[0, 1, 2, 3].map(item => <i className={item === step ? 'current' : ''} key={item}/>)}</div></header><section><h1>{titles[step]}</h1>{step === 0 && <><p>Name it and give it a job.</p><div className="chips">{Object.keys(roles).map(role => <button className={draft.role === role ? 'selected' : ''} onClick={() => pickRole(role)} key={role}>{role}</button>)}</div><Field label="NAME"><input value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}/><small>Lowercase profile handle, for example research-rabbit.</small></Field><Field label="WHAT SHOULD IT DO?"><input value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))}/></Field></>}{step === 1 && <><p>Optional — shape how it thinks and talks.</p><div className="explain">This becomes the Bot’s real SOUL.md and loads into every conversation.</div><Field label="SOUL"><textarea value={draft.soul} onChange={event => setDraft(current => ({ ...current, soul: event.target.value }))}/></Field></>}{step === 2 && <><p>Optional — pin a model, or use the Hermes default.</p><button className={!draft.model ? 'model-option selected' : 'model-option'} onClick={() => setDraft(current => ({ ...current, model: '', provider: '' }))}><b>Use Hermes default</b><small>Inherits this PC’s provider and model.</small></button><button className={draft.model === 'gpt-5.6-sol' ? 'model-option selected' : 'model-option'} onClick={() => setDraft(current => ({ ...current, model: 'gpt-5.6-sol', provider: 'openai-api' }))}>openai-api/gpt-5.6-sol</button></>}{step === 3 && <><p>Choose an avatar that remains identical in Hermes Desktop and Mobile.</p><BotAppearancePicker name={draft.name} shape={draft.shape} onShape={shape => setDraft(current => ({ ...current, shape }))}/></>}{error && <p className="wizard-error">{error}</p>}</section><footer><button className="secondary" onClick={() => step ? setStep(step - 1) : close()}>{step ? 'Back' : 'Cancel'}</button><button className="primary" disabled={creating || (step === 0 && !draft.name)} onClick={() => step < 3 ? setStep(step + 1) : finish()}>{creating ? 'Creating…' : step < 3 ? 'Continue' : 'Create Bot'}</button></footer></main>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>
}
