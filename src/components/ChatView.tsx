import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, Paperclip, RotateCw, X } from 'lucide-react'
import type { DragEvent } from 'react'

import { BotAvatar } from './BotAvatar'
import { MessageCard, MarkdownContent } from './MarkdownContent'
import type { ToolActivity } from '../App'
import { formatResponseStats } from '../message-stats'
import { useEdgeSwipeBack } from '../edge-swipe'
import { Composer, type ComposerDropFilesRef, type ComposerEditRequest } from './Composer'
import type { LiveMessage, LiveProfile, LiveSession, LiveUsage } from '../hermes'

type Timeline = LiveMessage & { local?: boolean }
type Props = {
  session: LiveSession
  conversationLoading: boolean
  messages: Timeline[]
  settledAssistant: { content: string; usage?: LiveUsage } | null
  profiles: LiveProfile[]
  streaming: string
  sending: boolean
  toolActivities: ToolActivity[]
  error: string
  back: () => void
  refresh: () => void
  openProfile: () => void
  onSessionModelChange: (model: string) => void
  submit: (attachments: { name: string; refText: string }[], text: string) => Promise<boolean>
  submitVoice: (text: string) => Promise<boolean>
  stop: () => void
}

const titleize = (value: string) => value.split(/[-_]+/).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join(' ')

export function ChatView({ session, conversationLoading, messages, settledAssistant, profiles, streaming, sending, toolActivities, error, back, refresh, openProfile, onSessionModelChange, submit, submitVoice, stop }: Props) {
  const shellRef = useRef<HTMLElement>(null)
  useEdgeSwipeBack(shellRef, back)
  const threadRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const initializedRef = useRef(false)
  const followingRef = useRef(true)
  const [following, setFollowing] = useState(true)
  const [unreadBelow, setUnreadBelow] = useState(0)
  const [revealedTimestampId, setRevealedTimestampId] = useState<number | null>(null)
  const [controlError, setControlError] = useState('')
  const [draggingFiles, setDraggingFiles] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const [pullRefreshing, setPullRefreshing] = useState(false)
  const pullStartRef = useRef<number | null>(null)
  const [editRequest, setEditRequest] = useState<ComposerEditRequest | null>(null)
  const [modelLabel, setModelLabel] = useState(session.model || '')
  const dropFilesRef: ComposerDropFilesRef = useRef<((files: File[]) => void) | null>(null)
  const botProfile = profiles.find(profile => profile.name === session.profile)
  const botName = botProfile?.display_name || (session.title && session.title !== 'Bot Chat' ? session.title : titleize(session.profile))

  const visibleError = error || controlError
  const activeAssistantText = settledAssistant?.content || streaming
  const settledStats = settledAssistant ? formatResponseStats({ id: -1, role: 'assistant', content: settledAssistant.content, usage: settledAssistant.usage }) : null
  const showActiveAssistant = sending || Boolean(settledAssistant)
  const showConversationLoading = conversationLoading
  const showEmptyState = !conversationLoading && !messages.length && !showActiveAssistant && !streaming && !toolActivities.length && !visibleError

  const scrollToLatest = (behavior: ScrollBehavior = 'smooth') => {
    const thread = threadRef.current
    if (!thread) return
    thread.scrollTo({ top: thread.scrollHeight, behavior })
    followingRef.current = true
    setFollowing(true)
    setUnreadBelow(0)
  }

  useEffect(() => {
    setDraggingFiles(false)
  }, [session.id])

  useLayoutEffect(() => {
    initializedRef.current = false
    followingRef.current = true
    setFollowing(true)
    setUnreadBelow(0)
    setRevealedTimestampId(null)
  }, [session.id])

  useLayoutEffect(() => {
    if (!messages.length || initializedRef.current) return
    initializedRef.current = true
    const frame = requestAnimationFrame(() => {
      scrollToLatest('auto')
      requestAnimationFrame(() => scrollToLatest('auto'))
    })
    return () => cancelAnimationFrame(frame)
  }, [messages.length])

  useEffect(() => {
    if (!initializedRef.current) return
    if (followingRef.current) requestAnimationFrame(() => scrollToLatest('auto'))
    else setUnreadBelow(count => count + 1)
  }, [messages.length, streaming])

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const observer = new ResizeObserver(() => {
      if (followingRef.current) requestAnimationFrame(() => scrollToLatest('auto'))
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  const onScroll = () => {
    const thread = threadRef.current
    if (!thread) return
    const nearEnd = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120
    followingRef.current = nearEnd
    setFollowing(nearEnd)
    if (nearEnd) setUnreadBelow(0)
  }

  const pullRefresh = async () => {
    setPullRefreshing(true)
    try { await Promise.resolve(refresh()) } finally { window.setTimeout(() => setPullRefreshing(false), 180) }
  }
  const onThreadTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (threadRef.current?.scrollTop === 0) pullStartRef.current = event.touches[0].clientY
  }
  const onThreadTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (pullStartRef.current == null || threadRef.current?.scrollTop !== 0) return
    const distance = Math.min(64, Math.max(0, event.touches[0].clientY - pullStartRef.current))
    if (distance > 0) event.preventDefault()
    setPullDistance(distance)
  }
  const onThreadTouchEnd = () => {
    const shouldRefresh = pullDistance >= 48
    pullStartRef.current = null
    setPullDistance(0)
    if (shouldRefresh && !pullRefreshing) void pullRefresh()
  }

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDraggingFiles(true)
  }
  const onDrop = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.files.length) return
    event.preventDefault()
    setDraggingFiles(false)
    dropFilesRef.current?.(Array.from(event.dataTransfer.files))
  }
  const editMessage = (text: string) => { setEditRequest({ text, nonce: Date.now() }) }

  return <main ref={shellRef} className="app chat-shell" onDragOver={onDragOver} onDrop={onDrop} onDragLeave={() => setDraggingFiles(false)}>
    {draggingFiles && <div className="file-drop-overlay" aria-live="polite"><div><Paperclip size={24}/><b>Drop files to upload to Hermes</b><span>Documents stay on the host for Hermes to read</span></div></div>}
    <header className="chat-header">
      <button className="round-control" onClick={back} aria-label="Back"><ArrowDown size={18} className="back-chevron"/></button>
      <div className="chat-title"><button className="chat-identity-button" onClick={openProfile} aria-label={`Open ${botName} settings`}><BotAvatar profile={botProfile} fallbackName={session.profile} variant="header"/><span><b>{botName}</b><small>{botName} · {sending ? 'Working' : modelLabel || 'Hermes default'}</small></span></button></div>
      <button className="round-control" onClick={refresh} aria-label="Refresh conversation"><RotateCw size={16}/></button>
    </header>

    {visibleError && <div className="chat-error"><span>{visibleError}</span><button onClick={() => setControlError('')}><X size={14}/></button></div>}

    <div className="thread-scroll" ref={threadRef} onScroll={onScroll} onTouchStart={onThreadTouchStart} onTouchMove={onThreadTouchMove} onTouchEnd={onThreadTouchEnd}>
      <div className="thread-content" ref={contentRef}>
        {(pullDistance > 8 || pullRefreshing) && <div className="chat-pull-cue" style={{ height: `${pullRefreshing ? 34 : pullDistance}px` }}><RotateCw size={14} className={pullRefreshing ? 'pull-refresh-spinner' : ''}/><span>{pullRefreshing ? 'Refreshing…' : pullDistance >= 48 ? 'Release to refresh' : 'Pull to refresh'}</span></div>}
        {showConversationLoading && <section className="chat-empty-state conversation-loading" aria-live="polite" aria-label={`Loading ${botName} conversation`}><BotAvatar profile={botProfile} fallbackName={session.profile} variant="welcome"/><h1>{botName.toUpperCase()}</h1><p>{botName} · {modelLabel || 'Hermes Desktop'}</p><LoadingSpinner/></section>}
        {showEmptyState && <section className="chat-empty-state" aria-label={`Start a conversation with ${botName}`}><BotAvatar profile={botProfile} fallbackName={session.profile} variant="welcome"/><h1>{botName.toUpperCase()}</h1><p>Say something to get started.</p></section>}
        {messages.map(message => <MessageCard key={message.id} message={message} onEdit={editMessage} profile={botProfile} fallbackName={session.profile} revealTimestamp={message.role === 'assistant' && revealedTimestampId === message.id} onRevealTimestamp={() => setRevealedTimestampId(current => current === message.id ? null : message.id)}/>)}
        {toolActivities.map(activity => <ToolActivityRow activity={activity} key={activity.id}/>)}
        {showActiveAssistant && <article className="message-row assistant-row live-response"><div className="assistant-message-layout"><BotAvatar profile={botProfile} fallbackName={session.profile} variant="message"/><div className="assistant-message-content">{sending && !streaming && <div className="live-label"><span className="stream-pulse"/> Thinking</div>}{activeAssistantText && <MarkdownContent>{activeAssistantText}</MarkdownContent>}<div className={`response-stats ${settledStats ? '' : 'response-stats-placeholder'}`} aria-label={settledStats ? 'Response generation statistics' : undefined} aria-hidden={settledStats ? undefined : true}>{settledStats || '\u00a0'}</div></div></div></article>}
      </div>
    </div>

    {!following && <button className="latest-button" onClick={() => scrollToLatest()}><ArrowDown size={15}/><span>Latest{unreadBelow ? ` · ${unreadBelow}` : ''}</span></button>}

    <Composer session={session} profiles={profiles} sending={sending} draggingFiles={draggingFiles} editRequest={editRequest} dropFilesRef={dropFilesRef} onControlError={setControlError} onModelLabel={setModelLabel} onSessionModelChange={onSessionModelChange} submit={submit} submitVoice={submitVoice} stop={stop}/>
  </main>
}

function LoadingSpinner() {
  return <span className="conversation-spinner" role="status" aria-label="Loading"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></span>
}

function ToolActivityRow({ activity }: { activity: ToolActivity }) {
  const running = activity.status === 'running'
  const failed = activity.status === 'failed'
  return <div className={`live-tool ${failed ? 'failed' : ''}`}><span className={running ? 'tool-spinner' : 'tool-state'}>{running ? '⋯' : failed ? '!' : '✓'}</span><span><b>{activity.name}</b><small>{running ? 'running…' : failed ? 'failed' : activity.summary || 'done'}</small></span>{activity.duration_s != null && <time>{activity.duration_s.toFixed(1)}s</time>}</div>
}
