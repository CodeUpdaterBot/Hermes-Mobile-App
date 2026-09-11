import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, BrainCircuit, Check, ChevronDown, FileText, LoaderCircle, Mic, Paperclip, RotateCw, Search, Sparkles, Square, Trash2, X } from 'lucide-react'
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react'

import { onError as onSttError, onResult as onSttResult, onStateChange as onSttStateChange, isAvailable as sttIsAvailable, requestPermission as requestSttPermission, startListening as startSttListening, stopListening as stopSttListening } from 'tauri-plugin-stt-api'
import { attachFile, completeSlash, loadModelOptions, setSessionModel, setSessionReasoning, type LiveMessage, type LiveProfile, type LiveSession, type LiveUsage, type ModelOptions, type SlashCompletion } from '../hermes'
import { BotAvatar } from './BotAvatar'
import { MessageCard, MarkdownContent } from './MarkdownContent'
import type { ToolActivity } from '../App'
import { applySlashCompletion } from '../slash-routing'
import { SCROLL_FOLLOW_THRESHOLD, shouldStickToBottom } from '../scroll-follow'
import { formatResponseStats } from '../message-stats'
import { isExpectedVoiceCleanupError, VOICE_AUTOSEND_HOLD_MS } from '../voice-input'
import { useEdgeSwipeBack } from '../edge-swipe'

type Timeline = LiveMessage & { local?: boolean }
type PendingAttachment = {
  id: string
  name: string
  size: number
  status: 'uploading' | 'ready' | 'error'
  refText?: string
  error?: string
}
type Props = {
  session: LiveSession
  conversationLoading: boolean
  messages: Timeline[]
  settledAssistant: { content: string; usage?: LiveUsage } | null
  profiles: LiveProfile[]
  draft: string
  setDraft: (text: string) => void
  mentions: LiveProfile[]
  streaming: string
  sending: boolean
  toolActivities: ToolActivity[]
  error: string
  back: () => void
  refresh: () => void
  openProfile: () => void
  onSessionModelChange: (model: string) => void
  submit: (attachments?: { name: string; refText: string }[]) => Promise<boolean>
  submitVoice: (text: string) => Promise<boolean>
  stop: () => void
}

const reasoningChoices = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']
const labelReasoning = (value: string) => value === 'none' ? 'Off' : value === 'xhigh' ? 'XHigh' : value[0].toUpperCase() + value.slice(1)
const titleize = (value: string) => value.split(/[-_]+/).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join(' ')

const toDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result || ''))
  reader.onerror = () => reject(new Error(`Could not read ${file.name}.`))
  reader.readAsDataURL(file)
})

const attachmentId = (file: File) => `${file.name}:${file.size}:${file.lastModified}`
const formatFileSize = (size: number) => size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`
const maxAttachmentBytes = 50 * 1024 * 1024

export function ChatView({ session, conversationLoading, messages, settledAssistant, profiles, draft, setDraft, mentions, streaming, sending, toolActivities, error, back, refresh, openProfile, onSessionModelChange, submit, submitVoice, stop }: Props) {
  const shellRef = useRef<HTMLElement>(null)
  useEdgeSwipeBack(shellRef, back)
  const threadRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const initializedRef = useRef(false)
  const followingRef = useRef(true)
  const stickQueuedRef = useRef(false)
  const [following, setFollowing] = useState(true)
  const [unreadBelow, setUnreadBelow] = useState(0)
  const [revealedTimestampId, setRevealedTimestampId] = useState<number | null>(null)
  const [modelMenu, setModelMenu] = useState(false)
  const [reasoningMenu, setReasoningMenu] = useState(false)
  const [modelSearch, setModelSearch] = useState('')
  const [modelOptions, setModelOptions] = useState<ModelOptions>({})
  const [model, setModel] = useState(session.model || '')
  const [provider, setProvider] = useState('')
  const [reasoning, setReasoning] = useState('medium')
  const [controlError, setControlError] = useState('')
  const [voiceState, setVoiceState] = useState<'idle' | 'starting' | 'listening' | 'processing'>('idle')
  const [voiceAutoSend, setVoiceAutoSend] = useState(false)
  const [voiceInterim, setVoiceInterim] = useState('')
  const [voiceReview, setVoiceReview] = useState('')
  const [recordSeconds, setRecordSeconds] = useState(0)
  const voiceAutoSendRef = useRef(false)
  const voiceCleanupExpectedRef = useRef(false)
  const voiceStartRequestRef = useRef(0)
  const voiceStartInFlightRef = useRef(false)
  const voiceStartedAtRef = useRef<number | null>(null)
  const holdTimerRef = useRef<number | null>(null)
  const ignoreMicClickRef = useRef(false)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [draggingFiles, setDraggingFiles] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const [pullRefreshing, setPullRefreshing] = useState(false)
  const pullStartRef = useRef<number | null>(null)
  const [slashItems, setSlashItems] = useState<SlashCompletion[]>([])
  const [slashReplaceFrom, setSlashReplaceFrom] = useState(1)
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashLoading, setSlashLoading] = useState(false)
  const botProfile = profiles.find(profile => profile.name === session.profile)
  const botName = botProfile?.display_name || (session.title && session.title !== 'Bot Chat' ? session.title : titleize(session.profile))

  const mentionOpen = /@[\w-]*$/.test(draft)
  const slashMatch = /(?:^|\s)(\/[^\s]*)$/.exec(draft)
  const slashText = slashMatch?.[1] || ''
  const slashStart = slashMatch ? slashMatch.index + slashMatch[0].length - slashText.length : -1
  const slashOpen = Boolean(slashText)
  const allModels = useMemo(() => (modelOptions.providers || []).flatMap(item => (item.featured_models?.length ? item.featured_models : item.models || []).map(name => ({ name, provider: item.slug, providerName: item.name, authenticated: item.authenticated !== false }))).filter((item, index, rows) => rows.findIndex(other => other.provider === item.provider && other.name === item.name) === index), [modelOptions])
  const filteredModels = useMemo(() => allModels.filter(item => `${item.name} ${item.providerName}`.toLowerCase().includes(modelSearch.toLowerCase())), [allModels, modelSearch])
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
    if (!followingRef.current) {
      followingRef.current = true
      setFollowing(prev => (prev ? prev : true))
    }
    setUnreadBelow(prev => (prev === 0 ? prev : 0))
  }

  const scheduleStickToBottom = (behavior: ScrollBehavior = 'auto') => {
    if (stickQueuedRef.current) return
    stickQueuedRef.current = true
    requestAnimationFrame(() => {
      stickQueuedRef.current = false
      if (!followingRef.current) return
      scrollToLatest(behavior)
    })
  }

  useEffect(() => {
    setAttachments([])
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
    if (followingRef.current) scheduleStickToBottom('auto')
    else setUnreadBelow(count => count + 1)
  }, [messages.length, streaming])

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const observer = new ResizeObserver(() => {
      if (followingRef.current) scheduleStickToBottom('auto')
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    void loadModelOptions(session.profile).then(options => {
      setModelOptions(options)
      setModel(current => current || options.model || '')
      setProvider(options.provider || '')
    }).catch(() => setModelOptions({}))
  }, [session.profile])

  useEffect(() => {
    let cancelled = false
    if (!slashText) {
      setSlashItems([])
      setSlashLoading(false)
      setSlashIndex(0)
      return () => { cancelled = true }
    }
    setSlashLoading(true)
    setSlashIndex(0)
    const timer = window.setTimeout(() => {
      void completeSlash(session.id, session.profile, slashText).then(result => {
        if (cancelled) return
        setSlashItems(Array.isArray(result.items) ? result.items : [])
        setSlashReplaceFrom(typeof result.replace_from === 'number' ? result.replace_from : 1)
      }).catch(() => {
        if (!cancelled) setSlashItems([])
      }).finally(() => {
        if (!cancelled) setSlashLoading(false)
      })
    }, 90)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [session.id, session.profile, slashText])

  useEffect(() => {
    const field = textareaRef.current
    if (!field) return
    field.style.height = '0px'
    field.style.height = `${Math.min(132, Math.max(24, field.scrollHeight))}px`
  }, [draft])

  const onScroll = () => {
    const thread = threadRef.current
    if (!thread) return
    const nearEnd = shouldStickToBottom(thread.scrollHeight, thread.scrollTop, thread.clientHeight, SCROLL_FOLLOW_THRESHOLD)
    if (nearEnd === followingRef.current) return
    followingRef.current = nearEnd
    setFollowing(nearEnd)
    if (nearEnd) setUnreadBelow(prev => (prev === 0 ? prev : 0))
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

  const chooseModel = async (nextProvider: string, nextModel: string) => {
    setControlError('')
    try {
      await setSessionModel(session.id, session.profile, nextProvider, nextModel)
      setProvider(nextProvider)
      setModel(nextModel)
      onSessionModelChange(nextModel)
      setModelMenu(false)
    } catch (reason) { setControlError(reason instanceof Error ? reason.message : 'Could not change this chat model.') }
  }

  const chooseReasoning = async (effort: string) => {
    setControlError('')
    try {
      await setSessionReasoning(session.id, session.profile, effort)
      setReasoning(effort)
      setReasoningMenu(false)
    } catch (reason) { setControlError(reason instanceof Error ? reason.message : 'Could not change reasoning effort.') }
  }

  const submitVoiceRef = useRef(submitVoice)
  const voiceDiscardRef = useRef(false)
  submitVoiceRef.current = submitVoice

  useEffect(() => {
    let active = true
    const unlistens: Array<() => void> = []
    const track = (subscription: Promise<() => void>) => { void subscription.then(unlisten => { if (active) unlistens.push(unlisten); else unlisten() }).catch(() => {}) }
    track(onSttResult(result => {
      if (!result.isFinal) { if (active) setVoiceInterim(result.transcript); return }
      const transcript = result.transcript.trim()
      if (!active) return
      const autoSend = voiceAutoSendRef.current
      const discard = voiceDiscardRef.current
      voiceCleanupExpectedRef.current = true
      voiceStartInFlightRef.current = false
      voiceDiscardRef.current = false
      voiceAutoSendRef.current = false
      setVoiceAutoSend(false)
      setVoiceInterim('')
      setVoiceState('idle')
      setRecordSeconds(0)
      if (!transcript || discard) return
      if (autoSend) void submitVoiceRef.current(transcript)
      else { setVoiceReview(transcript); setDraft(transcript) }
    }))
    track(onSttStateChange(event => {
      if (!active) return
      if (event.state === 'listening') setVoiceState('listening')
      else if (event.state === 'processing') setVoiceState('processing')
      else if (event.state === 'idle') { voiceStartInFlightRef.current = false; setVoiceState('idle'); setVoiceInterim(''); setRecordSeconds(0) }
    }))
    track(onSttError(error => {
      if (!active) return
      const cleanupError = isExpectedVoiceCleanupError(error, voiceCleanupExpectedRef.current)
      voiceStartInFlightRef.current = false
      voiceAutoSendRef.current = false
      setVoiceAutoSend(false)
      setVoiceState('idle')
      setVoiceInterim('')
      setRecordSeconds(0)
      if (!cleanupError && error.code !== 'CANCELLED') setControlError(error.code === 'NO_SPEECH' ? 'No speech was detected. Try again when you are ready.' : error.message || 'Voice input could not start.')
    }))
    return () => { active = false; unlistens.forEach(unlisten => unlisten()); void stopSttListening().catch(() => {}) }
  }, [])

  useEffect(() => {
    if (voiceState === 'idle') return
    const tick = () => { if (voiceStartedAtRef.current) setRecordSeconds(Math.floor((performance.now() - voiceStartedAtRef.current) / 1000)) }
    tick()
    const timer = window.setInterval(tick, 500)
    return () => window.clearInterval(timer)
  }, [voiceState])

  const startVoice = async (autoSend = false) => {
    if (voiceState !== 'idle' || sending) return
    const request = ++voiceStartRequestRef.current
    voiceStartInFlightRef.current = true
    voiceCleanupExpectedRef.current = false
    setControlError('')
    setVoiceInterim('')
    setVoiceState('starting')
    try {
      const permission = await requestSttPermission()
      if (request !== voiceStartRequestRef.current) return
      if (permission.microphone !== 'granted') throw new Error('Microphone permission is required. Allow Hermes Mobile to use your microphone, then try again.')
      if (permission.speechRecognition && permission.speechRecognition !== 'granted') throw new Error('Speech recognition permission is required. Allow Hermes Mobile to recognize speech, then try again.')
      const availability = await sttIsAvailable()
      if (request !== voiceStartRequestRef.current) return
      if (!availability.available) throw new Error(availability.reason || 'Speech recognition is not available on this device.')
      voiceDiscardRef.current = false
      voiceAutoSendRef.current = autoSend
      setVoiceAutoSend(autoSend)
      voiceStartedAtRef.current = performance.now()
      setRecordSeconds(0)
      await startSttListening({ language: navigator.language || 'en-US', interimResults: true, continuous: false, maxDuration: 45_000 })
      if (request !== voiceStartRequestRef.current) { voiceCleanupExpectedRef.current = true; await stopSttListening(); return }
      voiceStartInFlightRef.current = false
    } catch (reason) {
      if (request !== voiceStartRequestRef.current) return
      voiceStartInFlightRef.current = false
      voiceAutoSendRef.current = false
      setVoiceAutoSend(false)
      setVoiceState('idle')
      setRecordSeconds(0)
      setControlError(reason instanceof Error ? reason.message : 'Voice input could not start. Try again.')
    }
  }
  const finishVoice = async (discard = false) => {
    const startPending = voiceStartInFlightRef.current
    if (voiceState === 'idle' && !startPending) return
    if (startPending) {
      voiceStartRequestRef.current += 1
      voiceStartInFlightRef.current = false
      voiceAutoSendRef.current = false
      setVoiceAutoSend(false)
      setVoiceState('idle')
      setVoiceInterim('')
      setRecordSeconds(0)
      return
    }
    voiceDiscardRef.current = discard
    voiceCleanupExpectedRef.current = true
    setVoiceState('processing')
    try { await stopSttListening() }
    catch (reason) {
      voiceAutoSendRef.current = false
      setVoiceAutoSend(false)
      setVoiceState('idle')
      setRecordSeconds(0)
      if (!discard) setControlError(reason instanceof Error ? reason.message : 'Voice input could not stop.')
    }
  }
  const onMicPointerDown = () => {
    if (draft || sending || voiceState !== 'idle') return
    holdTimerRef.current = window.setTimeout(() => { ignoreMicClickRef.current = true; void startVoice(true) }, VOICE_AUTOSEND_HOLD_MS)
  }
  const onMicPointerUp = () => {
    if (holdTimerRef.current) { window.clearTimeout(holdTimerRef.current); holdTimerRef.current = null }
    if (ignoreMicClickRef.current) void finishVoice()
  }
  const onMicClick = () => {
    if (ignoreMicClickRef.current) { ignoreMicClickRef.current = false; return }
    void startVoice(false)
  }
  const chooseSlash = (item: SlashCompletion) => {
    if (slashStart < 0) return
    setDraft(applySlashCompletion(draft, slashStart, slashReplaceFrom, item.text))
    setSlashItems([])
    requestAnimationFrame(() => textareaRef.current?.focus())
  }
  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen && slashItems.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      setSlashIndex(index => event.key === 'ArrowDown' ? (index + 1) % slashItems.length : (index - 1 + slashItems.length) % slashItems.length)
      return
    }
    if (slashOpen && slashItems.length && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault()
      chooseSlash(slashItems[slashIndex] || slashItems[0])
      return
    }
  }
  const uploadAttachment = async (file: File, id: string) => {
    try {
      if (file.size > maxAttachmentBytes) throw new Error(`Files must be 50 MB or smaller (${file.name} is ${formatFileSize(file.size)}).`)
      const dataUrl = await toDataUrl(file)
      const uploaded = await attachFile(session.id, session.profile, { name: file.name, dataUrl })
      setAttachments(items => items.map(item => item.id === id ? { ...item, name: uploaded.name, status: 'ready', refText: uploaded.refText, error: undefined } : item))
    } catch (reason) {
      setAttachments(items => items.map(item => item.id === id ? { ...item, status: 'error', error: reason instanceof Error ? reason.message : 'Hermes could not upload this file.' } : item))
    }
  }
  const addFiles = (files: File[]) => {
    setControlError('')
    for (const file of files) {
      const id = attachmentId(file)
      setAttachments(items => items.some(item => item.id === id) ? items : [...items, { id, name: file.name, size: file.size, status: 'uploading' }])
      void uploadAttachment(file, id)
    }
  }
  const onFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files || []))
    event.target.value = ''
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
    addFiles(Array.from(event.dataTransfer.files))
  }
  const submitWithAttachments = async () => {
    const uploading = attachments.some(item => item.status === 'uploading')
    if (uploading) { setControlError('Wait for the file upload to finish, then send it to Hermes.'); return }
    const ready = attachments.filter((item): item is PendingAttachment & { refText: string } => item.status === 'ready' && Boolean(item.refText))
    if (!draft.trim() && !ready.length) return
    if (await submit(ready.map(item => ({ name: item.name, refText: item.refText })))) { setAttachments([]); setVoiceReview('') }
  }
  const editMessage = (text: string) => { setDraft(text); requestAnimationFrame(() => textareaRef.current?.focus()) }

  return <main ref={shellRef} className="app chat-shell" onDragOver={onDragOver} onDrop={onDrop} onDragLeave={() => setDraggingFiles(false)}>
    {draggingFiles && <div className="file-drop-overlay" aria-live="polite"><div><Paperclip size={24}/><b>Drop files to upload to Hermes</b><span>Documents stay on the host for Hermes to read</span></div></div>}
    <header className="chat-header">
      <button className="round-control" onClick={back} aria-label="Back"><ArrowDown size={18} className="back-chevron"/></button>
      <div className="chat-title"><button className="chat-identity-button" onClick={openProfile} aria-label={`Open ${botName} settings`}><BotAvatar profile={botProfile} fallbackName={session.profile} variant="header"/><span><b>{botName}</b><small>{botName} · {sending ? 'Working' : model || 'Hermes default'}</small></span></button></div>
      <button className="round-control" onClick={refresh} aria-label="Refresh conversation"><RotateCw size={16}/></button>
    </header>

    {visibleError && <div className="chat-error"><span>{visibleError}</span><button onClick={() => setControlError('')}><X size={14}/></button></div>}

    <div className="thread-scroll" ref={threadRef} onScroll={onScroll} onTouchStart={onThreadTouchStart} onTouchMove={onThreadTouchMove} onTouchEnd={onThreadTouchEnd}>
      <div className="thread-content" ref={contentRef}>
        {(pullDistance > 8 || pullRefreshing) && <div className="chat-pull-cue" style={{ height: `${pullRefreshing ? 34 : pullDistance}px` }}><RotateCw size={14} className={pullRefreshing ? 'pull-refresh-spinner' : ''}/><span>{pullRefreshing ? 'Refreshing…' : pullDistance >= 48 ? 'Release to refresh' : 'Pull to refresh'}</span></div>}
        {showConversationLoading && <section className="chat-empty-state conversation-loading" aria-live="polite" aria-label={`Loading ${botName} conversation`}><BotAvatar profile={botProfile} fallbackName={session.profile} variant="welcome"/><h1>{botName.toUpperCase()}</h1><p>{botName} · {model || 'Hermes Desktop'}</p><LoadingSpinner/></section>}
        {showEmptyState && <section className="chat-empty-state" aria-label={`Start a conversation with ${botName}`}><BotAvatar profile={botProfile} fallbackName={session.profile} variant="welcome"/><h1>{botName.toUpperCase()}</h1><p>Say something to get started.</p></section>}
        {messages.map(message => <MessageCard key={message.id} message={message} onEdit={editMessage} profile={botProfile} fallbackName={session.profile} revealTimestamp={message.role === 'assistant' && revealedTimestampId === message.id} onRevealTimestamp={() => setRevealedTimestampId(current => current === message.id ? null : message.id)}/>)}
        {toolActivities.map(activity => <ToolActivityRow activity={activity} key={activity.id}/>)}
        {showActiveAssistant && <article className="message-row assistant-row live-response"><div className="assistant-message-layout"><BotAvatar profile={botProfile} fallbackName={session.profile} variant="message"/><div className="assistant-message-content">{sending && !streaming && <div className="live-label"><span className="stream-pulse"/> Thinking</div>}{activeAssistantText && <MarkdownContent>{activeAssistantText}</MarkdownContent>}<div className={`response-stats ${settledStats ? '' : 'response-stats-placeholder'}`} aria-label={settledStats ? 'Response generation statistics' : undefined} aria-hidden={settledStats ? undefined : true}>{settledStats || '\u00a0'}</div></div></div></article>}
      </div>
    </div>

    {!following && <button className="latest-button" onClick={() => scrollToLatest()}><ArrowDown size={15}/><span>Latest{unreadBelow ? ` · ${unreadBelow}` : ''}</span></button>}

    {slashOpen && (slashItems.length || slashLoading) && <section className="slash-popover" aria-label="Hermes skills and commands" role="listbox"><div className="slash-popover-head"><Sparkles size={14}/><span>{slashLoading ? 'Loading Hermes skills…' : 'Hermes skills & commands'}</span></div>{slashItems.slice(0, 12).map((item, index) => <button className={`${index === slashIndex ? 'selected' : ''} ${item.kind === 'skill' ? 'skill' : 'command'}`} key={`${item.text}:${index}`} type="button" role="option" aria-selected={index === slashIndex} onMouseDown={event => event.preventDefault()} onClick={() => chooseSlash(item)}><span className="slash-item-icon">{item.kind === 'skill' ? <Sparkles size={14}/> : '/'}</span><span><b>{item.display || item.text}</b><small>{item.meta || (item.kind === 'skill' ? 'Installed Hermes skill' : 'Hermes command')}</small></span></button>)}</section>}
    {mentionOpen && <div className="mention-popover">{mentions.map(item => <button key={item.name} onClick={() => setDraft(draft.replace(/@[\w-]*$/, `@${item.name} `))}><BotAvatar profile={item} fallbackName={item.name} variant="mention"/><span><b>{item.display_name || titleize(item.name)}</b><small>@{item.name}</small></span></button>)}</div>}

    {(modelMenu || reasoningMenu) && <button className="popover-scrim" aria-label="Close menu" onClick={() => { setModelMenu(false); setReasoningMenu(false) }}/>} 
    {modelMenu && <section className="model-popover">
      <div className="model-search"><Search size={14}/><input value={modelSearch} onChange={event => setModelSearch(event.target.value)} placeholder="Search models"/></div>
      <small className="popover-label">Available models</small>
      <div className="model-list">{filteredModels.length ? filteredModels.map(item => <button className={item.name === model && item.provider === provider ? 'selected' : ''} disabled={!item.authenticated} key={`${item.provider}:${item.name}`} onClick={() => void chooseModel(item.provider, item.name)}><span><b>{item.name}</b><small>{item.providerName}</small></span>{item.name === model && item.provider === provider && <span>✓</span>}</button>) : <p>No configured models match.</p>}</div>
    </section>}
    {reasoningMenu && <section className="reasoning-popover"><small className="popover-label">Reasoning effort</small>{reasoningChoices.map(item => <button className={item === reasoning ? 'selected' : ''} key={item} onClick={() => void chooseReasoning(item)}><span>{labelReasoning(item)}</span>{item === reasoning && <span>✓</span>}</button>)}</section>}

    <footer className="chat-dock">
      {voiceState !== 'idle' ? <div className={`recording-composer ${voiceAutoSend ? 'voice-autosend' : ''}`}><button onClick={() => void finishVoice(true)} aria-label="Cancel voice input"><X size={18}/></button>{voiceAutoSend && <small className="voice-autosend-label">Auto-send</small>}<span><i/>0:{String(recordSeconds).padStart(2, '0')}</span><div className="voice-bars">{voiceState === 'processing' ? 'Transcribing your voice…' : voiceInterim || (voiceAutoSend ? 'Release to send' : 'Listening…')}</div><button className="composer-send" onClick={() => void finishVoice()} aria-label="Finish voice input"><ArrowUp size={16}/></button></div> : <div className={`ai-composer ${draggingFiles ? 'file-drop-active' : ''}`}>
        {draggingFiles && <div className="file-drop-hint"><Paperclip size={15}/><span>Drop files to send to Hermes</span></div>}
        {!!attachments.length && <div className="attachment-list" aria-label="Attached files">{attachments.map(item => <div className={`attachment-chip ${item.status}`} key={item.id}><FileText size={15}/><span><b>{item.name}</b><small>{item.error || (item.status === 'uploading' ? 'Uploading to Hermes…' : formatFileSize(item.size))}</small></span>{item.status === 'uploading' ? <LoaderCircle className="attachment-spinner" size={14}/> : item.status === 'ready' ? <Check size={14}/> : <span className="attachment-failed">!</span>}<button type="button" onClick={() => setAttachments(items => items.filter(current => current.id !== item.id))} aria-label={`Remove ${item.name}`}><Trash2 size={13}/></button></div>)}</div>}
        {voiceReview && <div className="voice-review" aria-label="Voice transcription ready to edit"><Mic size={15}/><span><b>Voice transcription</b><small>Edit before sending</small></span><button type="button" onClick={() => { setVoiceReview(''); setDraft('') }} aria-label="Discard voice transcription"><X size={14}/></button></div>}
        <textarea ref={textareaRef} value={draft} disabled={sending || voiceState !== 'idle'} rows={1} placeholder="Ask anything…  /commands" onChange={event => setDraft(event.target.value)} onKeyDown={handleComposerKeyDown}/>
        <div className="composer-toolbar">
          <input ref={fileInputRef} className="attachment-input" type="file" multiple onChange={onFileInput} aria-label="Choose files to attach"/>
          <button className={`composer-icon ${attachments.length ? 'attachment-active' : ''}`} disabled={sending || voiceState !== 'idle'} title="Attach files" onClick={() => fileInputRef.current?.click()} aria-label="Attach files"><Paperclip size={17}/></button>
          <button className="composer-selector" onClick={() => { setModelMenu(value => !value); setReasoningMenu(false) }}><span>{model || 'Default model'}</span><ChevronDown size={13}/></button>
          <button className="composer-selector effort" onClick={() => { setReasoningMenu(value => !value); setModelMenu(false) }}><BrainCircuit size={14}/><span>{labelReasoning(reasoning)}</span><ChevronDown size={13}/></button>
          <span className="toolbar-spacer"/>
          {!draft && !sending && <button className="composer-icon voice-trigger" disabled={voiceState !== 'idle'} title="Tap to dictate. Hold for 2.5 seconds to dictate and send." onPointerDown={onMicPointerDown} onPointerUp={onMicPointerUp} onPointerCancel={onMicPointerUp} onClick={onMicClick} aria-label="Record voice. Hold for 2.5 seconds to auto-send"><Mic size={17}/></button>}
          {sending ? <button className="composer-send stop" onClick={stop} aria-label="Stop Hermes"><Square size={12} fill="currentColor"/></button> : <button className="composer-send" disabled={!draft.trim() && !attachments.some(item => item.status === 'ready')} onClick={() => void submitWithAttachments()} aria-label="Send message"><ArrowUp size={17}/></button>}
        </div>
      </div>}
    </footer>
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
