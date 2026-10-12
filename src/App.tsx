import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Monitor, Plus, RefreshCw, Search, Settings as SettingsIcon, Users, X } from 'lucide-react'

import { ChatView } from './components/ChatView'
import { BotAvatar } from './components/BotAvatar'
import { BotAppearancePicker } from './components/BotAppearancePicker'
import { BotProfileSheet } from './components/BotProfileSheet'
import { TasksView } from './components/TasksView'
import { ConnectionSettings } from './components/ConnectionSettings'
import { ComputerPane } from './components/ComputerPane'
import { BotRoutines } from './components/BotRoutines'
import { BotCapabilities } from './components/BotCapabilities'
import { NewGroupSheet } from './components/NewGroupSheet'
import { GroupChat } from './components/GroupChat'
import { onBackButtonPress } from '@tauri-apps/api/app'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { flushSync } from 'react-dom'
import { buildAttachmentPrompt, attachmentSummary } from './attachment-routing'
import { buildBotRows, resolveCanonicalSessionId } from './live-model'
import { GatewayRpcError } from './gateway'
import { groupKey, groupMembersFor, groupNamesOf, groupsFromProfiles, groupRoomId } from './groups'
import { rememberRoomId } from './group-rooms'
import { settleAssistantResponse, type SettledAssistantResponse as SettledAssistantState } from './settled-assistant'
import { isActiveChatTurn } from './chat-turn'
import { errorMessage, RequestEpoch, selectRestoredEndpoint } from './connection-state'
import { navDirectionFor, setNavDirection } from './nav-direction'
import { haptic } from './haptics'
import { connectAndSubmit, createGroup, createProfile, interruptSession, loadMessages, loadSnapshot, savedHermesEndpoint, setActiveHermesEndpoint, setProfileGroups, setServerRequestHandler, type LiveMessage, type LiveProfile, type LiveSession, type LiveUsage } from './hermes'
import { parseClarifyQuestions } from './clarify'
import { readNotificationPreferences, type BotActivity, type BotStage } from './bot-notifications'
import { createNotificationSync, DEFAULT_BOT_NOTIFICATION_COLOR } from './notification-service'
import { rasterizeAvatarPng } from './avatar-raster'
import { reasoningSnippet } from './activity-group'

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
  const settledAssistantRef = useRef<SettledAssistantState | null>(null)
  settledAssistantRef.current = settledAssistant
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
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
  // A group chat is a screen of its own, not a mode of the Bot chat: it renders in the
  // same pane, so it has to be a first-class stop for Android Back and the edge-swipe
  // gesture (both walked past it before, which is why a group could not be swiped out of).
  const [openGroupName, setOpenGroupName] = useState<string | null>(null)

  const navigationRef = useRef({ selected: false, profileSheet: false, settings: false, createOpen: false, group: false, tab: 'bots' as Tab })
  navigationRef.current = {
    selected: Boolean(selected), profileSheet, settings, createOpen,
    group: Boolean(openGroupName), tab,
  }

  // Screen depth drives directional transitions: moving deeper pushes in,
  // coming back pops in. Layout effect so the attribute is written before the
  // browser paints the newly mounted screen.
  const screenDepth = createOpen || settings ? 1
    : selected ? (profileSheet ? 2 : 1)
    : openGroupName ? 1
    : tab === 'tasks' ? 1
    : 0
  const previousDepthRef = useRef(0)
  useLayoutEffect(() => {
    setNavDirection(navDirectionFor(previousDepthRef.current, screenDepth))
    previousDepthRef.current = screenDepth
  }, [screenDepth])

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
      // The group screen sits above the Bot chat: closing it must come first, or Back
      // leaves the group mounted and the next press walks past it entirely.
      if (navigation.group) { setOpenGroupName(null); return true }
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

  // A failure the user cannot see coming gets a distinct tactile warning.
  useEffect(() => {
    if (error) haptic('warning')
  }, [error])

  const activateEndpoint = (endpoint: string) => {
    const normalized = endpoint.replace(/\/$/, '')
    activeEndpointRef.current = normalized
    setActiveHermesEndpoint(normalized)
    setActiveEndpoint(normalized)
    return normalized
  }
  const refresh = useCallback(async (requestedEndpoint = activeEndpointRef.current, supersede = false): Promise<{ profiles: LiveProfile[]; sessions: LiveSession[] } | null> => {
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
  }, [])
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
      if (active) timer = window.setInterval(() => void refresh(activeEndpointRef.current), 5_000)
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

  // Group chats are derived from each Bot's profile metadata, so the roster the app
  // already loads is the authoritative list — no extra RPC round trip, and no
  // separate group record that can drift from its members.
  const groups = useMemo(() => groupsFromProfiles(profiles), [profiles])
  const visibleGroups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return needle ? groups.filter(group => group.name.toLowerCase().includes(needle)) : groups
  }, [groups, query])

  // Groups sit in the SAME recency-ordered list as Bot chats — a group is just
  // another conversation. A room carries no activity of its own here, so it borrows
  // its most recently active member's, which is the honest proxy available
  // client-side and needs no extra round trip.
  const rosterEntries = useMemo(() => {
    const activityOf = (members: string[]) => rows.reduce(
      (latest, row) => members.includes(row.profile.name) ? Math.max(latest, row.session?.last_active || 0) : latest, 0)
    return [
      ...visibleGroups.map(group => ({ kind: 'group' as const, key: `group:${group.name}`, group, lastActive: activityOf(group.members) })),
      ...rows.map(({ profile, session }) => ({ kind: 'bot' as const, key: profile.name, profile, session, lastActive: session?.last_active || 0 })),
    ].sort((a, b) => b.lastActive - a.lastActive)
  }, [rows, visibleGroups])

  const visibleSessions = useMemo(() => sessions.filter(session => `${session.title} ${session.profile} ${session.preview}`.toLowerCase().includes(query.toLowerCase())), [sessions, query])

  const openSession = useCallback((session: LiveSession, latestUsage?: LiveUsage): Promise<void> => {
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
  }, [])

  const submit = useCallback(async (attachmentRefs: { name: string; refText: string }[] = [], rawText = ''): Promise<boolean> => {
    const turnSession = selectedRef.current
    if (!turnSession || sendingRef.current) return false
    const turnId = ++chatTurnGenerationRef.current
    const turnSessionRef = { id: turnSession.id, profile: turnSession.profile }
    const isCurrentTurn = () => isActiveChatTurn(turnId, chatTurnGenerationRef.current, turnSessionRef, selectedRef.current)
    const text = rawText.trim()
    if (!text && !attachmentRefs.length) return false
    const prompt = buildAttachmentPrompt(text, attachmentRefs)
    let completionUsage: LiveUsage | undefined
    let finalText = ''
    const settledSnapshot = settledAssistantRef.current
    const priorSettled = settledSnapshot?.sessionId === turnSession.id && settledSnapshot.profile === turnSession.profile ? settledSnapshot : null
    const priorAssistantMessage = priorSettled ? { id: -(Date.now() + 1), role: 'assistant' as const, content: priorSettled.content, usage: priorSettled.usage } : null
    const localUserMessage = { id: -Date.now(), role: 'user' as const, content: attachmentSummary(text, attachmentRefs) }
    setSettledAssistant(null)
    setError('')
    setSending(true)
    setStreaming('')
    setToolActivities([])
    setMessages(items => [...items, ...(priorAssistantMessage ? [priorAssistantMessage] : []), localUserMessage])
    try {
      await connectAndSubmit(turnSession.id, turnSession.profile, prompt, (type, payload) => {
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
      const terminalAssistant = settleAssistantResponse(turnSession.id, turnSession.profile, finalText, completionUsage)
      if (terminalAssistant) {
        setSettledAssistant(terminalAssistant)
        setSending(false)
        setStreaming('')
      } else {
        await openSession(turnSession, completionUsage)
      }
      await refresh()
      return true
    } catch (reason) {
      if (isCurrentTurn()) {
        // A held lease is not a failure of this app. Hermes allows one live process per
        // session, so a chat the Desktop is holding cannot be driven from this device -
        // its transcript still reads, only sending is refused. Explain that and name the
        // two real options, instead of echoing the raw refusal at the user.
        const held = reason instanceof GatewayRpcError && reason.sessionHeldElsewhere
        setError(held
          ? 'This chat is open in another Hermes window, so it cannot take a message from this device. Close it there to continue here, or start a new chat with this Bot.'
          : errorMessage(reason, 'Could not send to Hermes.'))
      }
      return false
    } finally {
      if (isCurrentTurn()) {
        setSending(false)
        setStreaming('')
      }
    }
  }, [openSession, refresh])

  const stop = useCallback(async () => {
    const turnSession = selectedRef.current
    if (!turnSession || !sendingRef.current) return
    try { await interruptSession(turnSession.id) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not stop this Hermes turn.') }
  }, [])

  const submitVoice = useCallback((text: string) => submit([], text), [submit])

  // Keep the lock screen in step with a running turn. Only the conversation this
  // client has resumed can report progress: the gateway's per-turn events are
  // session-scoped, and its global `sessions.changed` is a bare "refetch the list"
  // signal that carries no progress at all.
  const notificationSync = useRef(createNotificationSync())
  useEffect(() => {
    const preferences = readNotificationPreferences()
    const botProfile = selected ? profiles.find(profile => profile.name === selected.profile) : undefined
    if (!selected || !(sending || toolActivities.length)) {
      void notificationSync.current.sync([], preferences, new Date().getHours())
      return
    }

    const activeTool = toolActivities[toolActivities.length - 1]
    const thinkingStep = messages[messages.length - 1]?.role === 'assistant' ? messages[messages.length - 1].reasoning : null
    const stage: BotStage = activeTool ? 'tools' : streaming ? 'writing' : 'thinking'
    const detail = activeTool
      ? activeTool.name
      : streaming
        ? 'Writing a reply'
        : thinkingStep ? reasoningSnippet(thinkingStep) || 'Thinking' : 'Thinking'

    let cancelled = false
    void (async () => {
      const meta = botProfile?.ui_meta?.['hermes-bots']
      // The Bot's own avatar, so several working Bots are distinguishable at a glance.
      const avatar = await rasterizeAvatarPng(selected.profile, meta?.shape, meta?.color)
      if (cancelled) return
      const active: BotActivity[] = [{
        key: `${selected.profile}::${selected.id}`,
        bot: botProfile?.display_name || titleize(selected.profile),
        profile: selected.profile,
        detail,
        stage,
        stepsDone: toolActivities.filter(item => item.status === 'done').length,
        // No todo total is published yet, so the bar is a coarse phase estimate.
        stepsTotal: null,
        running: sending,
        failed: toolActivities.some(item => item.status === 'failed'),
        color: DEFAULT_BOT_NOTIFICATION_COLOR,
        avatar,
      }]
      await notificationSync.current.sync(active, preferences, new Date().getHours())
    })()
    return () => { cancelled = true }
  }, [selected, sending, streaming, toolActivities, profiles, messages])

  // Wide screens (tablet landscape, unfolded foldables) get the three-column
  // workspace. Narrow phones keep the single-surface flow untouched.
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches)
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [contextCollapsed, setContextCollapsed] = useState(false)
  // Dragged column widths. Null means "use the stylesheet's values", so the responsive
  // defaults still apply until the user actually drags a divider.
  const [railWidth, setRailWidth] = useState<number | null>(null)
  const [contextWidth, setContextWidth] = useState<number | null>(null)
  const [newGroupOpen, setNewGroupOpen] = useState(false)
  const [groupBusy, setGroupBusy] = useState(false)
  const [groupError, setGroupError] = useState('')
  const [computerOpen, setComputerOpen] = useState(true)
  useEffect(() => {
    const query = window.matchMedia('(min-width: 900px)')
    const onChange = (event: MediaQueryListEvent) => setWide(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  // Widening while on the Bots list must not show a second copy of the roster in
  // the middle pane. Open the most recently active Bot Chat instead, so the
  // tri-fold always has a real conversation in its centre.
  // This reads `rows` (not buildBotRows) so the Bot it opens is exactly the top row
  // of the rail — and so the session carries its resolved lineage id.
  const mostRecentSession = rows[0]?.session ?? null
  useEffect(() => {
    if (!wide || selected || settings || createOpen || profileSheet) return
    if (!mostRecentSession) return
    void openSession(mostRecentSession)
  }, [wide, selected, settings, createOpen, profileSheet, mostRecentSession, openSession])

  // The host asks the user questions mid-turn (`clarify`). Answering over the same
  // socket is what releases its turn: an ignored request stalls until the host's
  // own clarify timeout, so anything unanswerable is refused immediately instead.
  const clarifyResolverRef = useRef<((reply: { result: unknown }) => void) | null>(null)
  const [clarifyParams, setClarifyParams] = useState<unknown | null>(null)
  useEffect(() => {
    setServerRequestHandler(request => {
      if (request.method !== 'clarify') {
        return Promise.resolve({ error: { code: -32601, message: `Method not found: ${request.method}` } })
      }
      if (!parseClarifyQuestions(request.params).length) return Promise.resolve({ result: {} })
      return new Promise<{ result: unknown }>(resolve => {
        clarifyResolverRef.current = resolve
        setClarifyParams(request.params)
      })
    })
    return () => setServerRequestHandler(undefined)
  }, [])

  const answerClarify = useCallback((result: unknown) => {
    clarifyResolverRef.current?.({ result })
    clarifyResolverRef.current = null
    setClarifyParams(null)
  }, [])

  const handleSessionModelChange = useCallback((model: string) => {
    setSelected(current => current ? { ...current, model } : current)
  }, [])

  const finishCreate = async () => {
    setCreating(true)
    setError('')
    try {
      await createProfile(botDraft)
      setCreateOpen(false)
      setCreateStep(0)
      haptic('success')
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

  // A native tab switch starts the new list at the top instead of keeping the
  // previous tab's scroll offset.
  useEffect(() => {
    rosterScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' })
  }, [tab])

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

  // Every screen is built as a value so the wide shell can host ANY of them in its
  // middle pane, instead of the tri-fold collapsing back to a single column.
  const wizardView = <CreateWizard step={createStep} setStep={setCreateStep} draft={botDraft} setDraft={setBotDraft} creating={creating} error={error} close={() => { setCreateOpen(false); setCreateStep(0); setError('') }} finish={() => void finishCreate()}/>
  const settingsView = <ConnectionSettings profiles={profiles.length} botProfiles={profiles} sessions={sessions.length} connected={connectionStatus === 'connected'} endpoint={activeEndpoint !== 'http://127.0.0.1:9119' ? activeEndpoint : undefined} theme={theme} setTheme={setTheme} close={() => setSettings(false)} refresh={() => refresh()} onPairingBusy={setPairingBusyState} onPaired={async endpoint => { const normalized = activateEndpoint(endpoint); const data = await refresh(normalized, true); if (!data) throw new Error(lastConnectionErrorRef.current || 'Signed in, but authenticated Hermes REST or live WebSocket verification failed.'); localStorage.setItem('hermes-mobile-active-endpoint', normalized) }}/>
  const profileView = selected && profileSheet ? <BotProfileSheet profile={profiles.find(profile => profile.name === selected.profile)} session={selected} onClose={() => setProfileSheet(false)} onUpdated={() => void refresh()}/> : null
  const chatView = selected ? <ChatView session={selected} wide={wide} conversationLoading={conversationLoading} messages={messages} settledAssistant={settledAssistant?.sessionId === selected.id && settledAssistant.profile === selected.profile ? settledAssistant : null} profiles={profiles} streaming={streaming} sending={sending} toolActivities={toolActivities} error={error} back={() => setSelected(null)} refresh={() => void openSession(selected)} openProfile={() => setProfileSheet(true)} onSessionModelChange={handleSessionModelChange} submit={submit} submitVoice={submitVoice} stop={stop} clarify={clarifyParams} onClarifyAnswer={answerClarify}/> : null
  const tasksView = <TasksView back={() => setTab('bots')} profiles={profiles}/>

  const homeView = <main className="app roster-shell">
    <div className="roster-pinned">
      <header className="roster-head"><div><h1>{tab === 'bots' ? 'Bots' : 'Sessions'}</h1><span className={`connection ${connectionStatus === 'disconnected' ? 'offline' : connectionStatus === 'connected' ? 'online' : 'checking'}`} title={connectionStatus === 'disconnected' ? 'No Hermes detected. Start Hermes Desktop, then retry.' : connectionStatus === 'connected' ? 'Connected to Hermes Desktop' : 'Checking for Hermes Desktop…'} aria-label={connectionStatus === 'disconnected' ? 'Hermes Desktop unavailable' : connectionStatus === 'connected' ? 'Connected to Hermes Desktop' : 'Checking for Hermes Desktop'}><i className="connection-dot"/><span>{connectionStatus === 'disconnected' ? 'Hermes unavailable' : connectionStatus === 'connected' ? 'Hermes Desktop' : 'Checking…'}</span></span></div><div className="header-actions"><button className="icon-button" aria-label="Search" onClick={() => setSearching(value => !value)}><Search size={18}/></button><button className="icon-button" aria-label="Settings" onClick={() => setSettings(true)}><SettingsIcon size={18}/></button></div></header>
      {searching && <div className="search"><Search size={16}/><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={tab === 'bots' ? 'Search bots and group chats…' : 'Search sessions…'}/><button onClick={() => { setQuery(''); setSearching(false) }}><X size={16}/></button></div>}
      <nav className="tabs"><button className={tab === 'bots' ? 'active' : ''} onClick={() => setTab('bots')}>Bots</button><button className={tab === 'sessions' ? 'active' : ''} onClick={() => setTab('sessions')}>Sessions</button><button onClick={() => setTab('tasks')}>Tasks</button></nav>
    </div>
    <div className="roster-list-scroll" ref={rosterScrollRef} onTouchStart={rosterTouchStart} onTouchMove={rosterTouchMove} onTouchEnd={rosterTouchEnd}>
      {rosterPullActive && <div className="roster-pull-cue" style={{ height: `${rosterPullRefreshing ? 46 : rosterPullDistance}px` }}><RefreshCw size={15} className={rosterPullRefreshing ? 'pull-refresh-spinner' : ''}/><span>{rosterPullRefreshing ? 'Refreshing…' : rosterPullDistance >= 56 ? 'Release to refresh' : 'Pull to refresh'}</span></div>}
      {error && <Notice message={error} retry={() => void refresh()}/>}
      {loading && !profiles.length ? <Skeleton/> : tab === 'bots' ? <section className="bot-list">{rosterEntries.map((entry, index) => entry.kind === 'group' ? <button className="bot-row group-row enter" style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }} key={entry.key} onClick={() => setOpenGroupName(entry.group.name)}><span className="group-glyph"><Users size={17}/></span><span className="bot-copy"><b>{entry.group.name}</b><small>{entry.group.members.length} bots · {entry.group.members.map(name => titleize(name)).join(', ')}</small></span><span className="meta">{entry.lastActive ? ago(entry.lastActive) : ''}</span></button> : <button className="bot-row enter" style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }} key={entry.key} disabled={!entry.session} onClick={() => entry.session && void openSession(entry.session)}><BotAvatar profile={entry.profile} fallbackName={entry.profile.name}/><span className="bot-copy"><b>{entry.profile.display_name || titleize(entry.profile.name)}</b><small>{entry.session?.preview || entry.profile.description || 'No messages yet'} </small></span><span className="meta">{ago(entry.session?.last_active)}{entry.session && <i className={entry.session.unread ? 'unread' : ''}/>}</span></button>)}</section> : <section className="bot-list">{visibleSessions.map((session, index) => <button className="bot-row enter" style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }} key={`${session.profile}:${session.id}`} onClick={() => void openSession(session)}><BotAvatar profile={profiles.find(profile => profile.name === session.profile)} fallbackName={session.profile} variant="session"/><span className="bot-copy"><b>{session.title || 'Untitled session'}</b><small>{titleize(session.profile)} · {session.preview}</small></span><span className="meta">{ago(session.last_active)}</span></button>)}</section>}
    </div>
    <footer className="roster-actions">{tab === 'bots' ? <><button className="secondary" onClick={() => { setGroupError(''); setNewGroupOpen(true) }}><Users size={16}/> New group</button><button className="primary" onClick={() => setCreateOpen(true)}><Plus size={16}/> New Bot</button></> : <button className="primary wide" onClick={() => setTab('bots')}>Back to Bots</button>}</footer>
  </main>

  // Membership is written first: it is what makes the group exist for every client
  // and it does not need a room driver. Opening the room does, so a gateway without
  // one still ends up with a usable, visible group rather than a silent failure.
  async function createBotGroup(name: string, members: LiveProfile[]) {
    setGroupBusy(true); setError('')
    try {
      for (const member of members) {
        const existing = groupNamesOf(member)
        // Case-insensitive, because the sheet suggests a lowercased name while the
        // metadata may already hold the group under the user's original casing —
        // writing again would store the same group twice and split its room.
        const known = existing.some(held => held.toLowerCase() === name.trim().toLowerCase())
        if (!known) await setProfileGroups(member, [...existing, name])
      }
      let roomWarning = ''
      try {
        const room = await createGroup(members[0].name, {
          roomId: groupRoomId(name), name,
          // groups.create requires member_id + profile + handle on every member and
          // rejects anything else, so the rows come from one shared builder.
          members: groupMembersFor(members),
        })
        // Pin the id the gateway actually holds: the name-derived id is what makes
        // creation converge, but only the id that comes back is what a read can
        // address exactly.
        if (room?.room_id) rememberRoomId(name, room.room_id)
      } catch (reason) {
        roomWarning = errorMessage(reason, 'The gateway could not open this room.')
      }
      await refresh()
      setNewGroupOpen(false)
      // Drop straight into the room. Creating a group is almost always followed by
      // wanting to talk to its members, so open it exactly as tapping its row would,
      // rather than leaving the user on the roster to find it themselves.
      setSelected(null)
      setOpenGroupName(name)
      if (roomWarning) setError(`Group “${name}” was saved, but the gateway could not open its room: ${roomWarning}`)
    } catch (reason) {
      // Never fall back to a generic string: a non-Error rejection previously hid the
      // real cause behind "Could not create this group."
      setGroupError(`Could not create this group: ${errorMessage(reason, 'unknown error')}`)
    } finally { setGroupBusy(false) }
  }

  const newGroupView = <NewGroupSheet profiles={profiles} busy={groupBusy} error={groupError} onClose={() => { setNewGroupOpen(false); setGroupError('') }} onCreate={(name, members) => void createBotGroup(name, members)}/>

  // A group chat is a conversation like any other: it opens in the same slot, and
  // inside the wide shell it renders in the middle pane rather than replacing it.
  // Case-insensitive: the name written at creation and the spelling the roster settled
  // on can differ only in case, and an exact match would then open nothing at all.
  const openGroup = openGroupName ? groups.find(group => groupKey(group.name) === groupKey(openGroupName)) : undefined
  const groupView = openGroup ? <GroupChat group={openGroup} profiles={profiles} wide={wide} back={() => setOpenGroupName(null)}/> : null

  const screen = newGroupOpen ? newGroupView : createOpen ? wizardView : settings ? settingsView : profileView ?? groupView ?? chatView ?? (tab === 'tasks' ? tasksView : homeView)

  if (!wide) return screen

  const activeProfile = selected ? profiles.find(profile => profile.name === selected.profile) : undefined
  const activeBotName = activeProfile?.display_name || (selected?.title && selected.title !== 'Bot Chat' ? selected.title : selected ? titleize(selected.profile) : '')

  // A divider both drags and toggles. Dragging past a few pixels resizes the column to
  // wherever the finger/pointer ends; releasing without dragging toggles it, so the old
  // click behaviour survives and no gesture has to be discovered. The listener is bound
  // to the divider itself once the pointer is captured, so it cannot leak past release.
  function dragColumn(kind: 'rail' | 'context', event: { clientX: number; pointerId: number; currentTarget: HTMLButtonElement }) {
    const startX = event.clientX
    const startWidth = (kind === 'rail' ? railWidth : contextWidth) ?? 296
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    let dragged = false
    const onMove = (move: PointerEvent) => {
      const delta = move.clientX - startX
      if (!dragged && Math.abs(delta) < 4) return
      dragged = true
      // The right column grows leftwards, so its delta is inverted.
      const next = kind === 'rail' ? startWidth + delta : startWidth - delta
      const clamped = Math.max(180, Math.min(460, next))
      if (kind === 'rail') setRailWidth(clamped); else setContextWidth(clamped)
    }
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      if (dragged) return
      if (kind === 'rail') setRailCollapsed(value => !value); else setContextCollapsed(value => !value)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }

  // The tri-fold workspace. Every screen renders in the middle pane, so opening a
  // Bot's settings no longer collapses the layout back to a single column.
  return <div className={`wide-shell${railCollapsed ? ' rail-collapsed' : ''}${contextCollapsed ? ' context-collapsed' : ''}`}
    style={railWidth === null && contextWidth === null ? undefined : {
      gridTemplateColumns: `${railCollapsed ? 0 : railWidth ?? 296}px 7px minmax(340px,1fr) 7px ${contextCollapsed ? 0 : contextWidth ?? 296}px`,
    }}>
    {railCollapsed && <button className="wide-rail-reveal" onClick={() => setRailCollapsed(false)} aria-label="Show Bots column"><ChevronRight size={13}/></button>}
    {contextCollapsed && <button className="wide-context-reveal" onClick={() => setContextCollapsed(false)} aria-label="Show computer column"><ChevronLeft size={13}/></button>}

    <aside className="wide-rail" aria-label="Bots">
      <header className="wide-rail-head">
        <b>Bots</b>
        <span className="wide-rail-actions">
          <button className="round-control" onClick={() => setSearching(value => !value)} aria-label="Search Bots"><Search size={16}/></button>
          <button className="round-control" onClick={() => setSettings(true)} aria-label="Settings"><SettingsIcon size={16}/></button>
        </span>
      </header>
      {searching && <div className="wide-rail-search"><Search size={15}/><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search bots…"/><button onClick={() => { setQuery(''); setSearching(false) }} aria-label="Clear search"><X size={15}/></button></div>}
      <section className="bot-list wide-rail-list">{rows.map(({ profile, session }, index) => <button className={`bot-row${session && session.id === selected?.id ? ' selected' : ''}`} style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }} key={profile.name} disabled={!session} onClick={() => session && void openSession(session)}><BotAvatar profile={profile} fallbackName={profile.name}/><span className="bot-copy"><b>{profile.display_name || titleize(profile.name)}</b><small>{session?.preview || profile.description || 'No messages yet'}</small></span><span className="meta">{ago(session?.last_active)}{session && <i className={session.unread ? 'unread' : ''}/>}</span></button>)}</section>
    </aside>

    <button className="wide-divider" onPointerDown={event => dragColumn('rail', event)} aria-label="Drag to resize the Bots column, or click to toggle it" title="Drag to resize · click to toggle"/>

    <div className="wide-main">{screen}</div>

    <button className="wide-divider" onPointerDown={event => dragColumn('context', event)} aria-label="Drag to resize the computer column, or click to toggle it" title="Drag to resize · click to toggle"/>

    <aside className="wide-context" aria-label="Bot computer and routines">
      {selected ? <>
        {computerOpen
          ? <ComputerPane profile={selected.profile} botName={activeBotName} onClose={() => setComputerOpen(false)}/>
          : <div className="computer-pane"><button className="secondary wide" onClick={() => setComputerOpen(true)}><Monitor size={15}/> Show computer</button></div>}
        <BotRoutines profile={selected.profile} onNewRoutine={() => { setSelected(null); setTab('tasks') }}/>
        <BotCapabilities profileName={selected.profile} onOpenSettings={() => setProfileSheet(true)} onUpdated={() => void refresh()}/>
      </> : <p className="wide-context-empty">Open a Bot to see its computer and routines.</p>}
    </aside>
  </div>
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
  return <main className="app wizard"><header><button className="icon-button" onClick={close}><X size={18}/></button><div className="progress">{[0, 1, 2, 3].map(item => <i className={item === step ? 'current' : ''} key={item}/>)}</div></header><section key={step}><h1>{titles[step]}</h1>{step === 0 && <><p>Name it and give it a job.</p><div className="chips">{Object.keys(roles).map(role => <button className={draft.role === role ? 'selected' : ''} onClick={() => pickRole(role)} key={role}>{role}</button>)}</div><Field label="NAME"><input value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}/><small>Lowercase profile handle, for example research-rabbit.</small></Field><Field label="WHAT SHOULD IT DO?"><input value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))}/></Field></>}{step === 1 && <><p>Optional — shape how it thinks and talks.</p><div className="explain">This becomes the Bot’s real SOUL.md and loads into every conversation.</div><Field label="SOUL"><textarea value={draft.soul} onChange={event => setDraft(current => ({ ...current, soul: event.target.value }))}/></Field></>}{step === 2 && <><p>Optional — pin a model, or use the Hermes default.</p><button className={!draft.model ? 'model-option selected' : 'model-option'} onClick={() => setDraft(current => ({ ...current, model: '', provider: '' }))}><b>Use Hermes default</b><small>Inherits this PC’s provider and model.</small></button><button className={draft.model === 'gpt-5.6-sol' ? 'model-option selected' : 'model-option'} onClick={() => setDraft(current => ({ ...current, model: 'gpt-5.6-sol', provider: 'openai-api' }))}><b>gpt-5.6-sol</b><small>OpenAI API</small></button></>}{step === 3 && <><p>Choose an avatar that remains identical in Hermes Desktop and Mobile.</p><BotAppearancePicker name={draft.name} shape={draft.shape} onShape={shape => setDraft(current => ({ ...current, shape }))}/></>}{error && <p className="wizard-error">{error}</p>}</section><footer><button className="secondary" onClick={() => step ? setStep(step - 1) : close()}>{step ? 'Back' : 'Cancel'}</button><button className="primary" disabled={creating || (step === 0 && !draft.name)} onClick={() => step < 3 ? setStep(step + 1) : finish()}>{creating ? 'Creating…' : step < 3 ? 'Continue' : 'Create Bot'}</button></footer></main>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>
}
