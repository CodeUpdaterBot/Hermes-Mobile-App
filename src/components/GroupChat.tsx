import { useEffect, useRef, useState } from 'react'
import { ArrowDown, RotateCw, Send, Users } from 'lucide-react'

import type { GroupEvent, GroupMember, GroupRoom, LiveProfile } from '../hermes'
import { createGroup, listGroups, loadGroupCapabilities, loadGroupLog, sendGroupMessage } from '../hermes'
import type { BotGroup } from '../groups'
import { groupMembersFor, groupRoomId } from '../groups'
import { readRoomIds, rememberRoomId, resolveRoom } from '../group-rooms'
import { useEdgeSwipeBack } from '../edge-swipe'
import { BotAvatar } from './BotAvatar'

type Props = { group: BotGroup; profiles: LiveProfile[]; wide?: boolean; back: () => void }

/** How often an open room is polled for events appended after the last read. */
const ROOM_POLL_MS = 1500

type Line =
  | { kind: 'user'; key: string; text: string }
  | { kind: 'bot'; key: string; text: string; who: string; profile?: LiveProfile; memberId?: string }
  | { kind: 'status'; key: string; text: string }

const titleize = (value: string) => value.split(/[-_]+/).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join(' ')

/** A `message.member` reply is attributed by `member_id` → the room's roster. */
function memberOf(room: GroupRoom | null, memberId?: string): GroupMember | undefined {
  return (room?.members || []).find(member => member.member_id === memberId)
}

/**
 * A room event's `payload` as an object. The gateway serialises it as JSON, and a
 * transport is free to hand it back as the string it travelled in — reading `payload.text`
 * off a string yielded empty bubbles, so normalise before it reaches the renderer.
 */
function eventPayload(event: GroupEvent): Record<string, unknown> {
  const raw = event.payload
  if (typeof raw === 'string') {
    try { const parsed: unknown = JSON.parse(raw); return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {} } catch { return {} }
  }
  return raw && typeof raw === 'object' ? raw : {}
}

function toLines(events: GroupEvent[], room: GroupRoom | null): Line[] {
  const lines: Line[] = []
  for (const event of events) {
    const payload = eventPayload(event)
    const text = typeof payload.text === 'string' ? payload.text : ''
    const key = `${event.seq}`
    if (event.kind === 'message.user') { lines.push({ kind: 'user', key, text }); continue }
    if (event.kind === 'message.member') {
      const memberId = typeof payload.member_id === 'string' ? payload.member_id : undefined
      const member = memberOf(room, memberId)
      lines.push({ kind: 'bot', key, text, memberId, who: member?.display_name || member?.profile || 'Bot' })
      continue
    }
    // turn.settled / turn.failed / cancellations: worth a quiet line, never chat text.
    if (event.kind.startsWith('turn.')) {
      const failed = event.kind === 'turn.failed'
      lines.push({ kind: 'status', key, text: failed ? `A turn failed${typeof payload.error === 'string' ? ` — ${payload.error}` : ''}` : 'turn settled' })
    }
  }
  return lines
}

/**
 * A group chat, rendered with the same shell as a Bot chat so it reads as just
 * another conversation. Replies are `message.member` events, so each Bot is
 * attributed individually rather than through one assistant identity.
 */
export function GroupChat({ group, profiles, wide = false, back }: Props) {
  const [room, setRoom] = useState<GroupRoom | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [loading, setLoading] = useState(true)
  const [roomError, setRoomError] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [nonce, setNonce] = useState(0)
  const [driver, setDriver] = useState<boolean | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const shellRef = useRef<HTMLElement>(null)
  // The room log read so far, keyed by seq: a poll appends only what is new, and the
  // highest seq we hold is the `since_seq` for the next read.
  const eventsRef = useRef<GroupEvent[]>([])
  const cursorRef = useRef(0)
  // The room service is profile-scoped; any member's profile addresses the room.
  const anchor = group.members[0]
  const memberLine = group.members.map(name => titleize(name)).join(', ')

  // A group chat is a nested screen exactly like a Bot chat, so it owns the same
  // edge-swipe-to-go-back contract (the wide layout has no back gesture at all).
  useEdgeSwipeBack(shellRef, back, !wide)

  /** Merge newly read events into the thread and advance the read cursor. */
  const mergeEvents = (roomForLines: GroupRoom | null, incoming: GroupEvent[]): Line[] => {
    const bySeq = new Map(eventsRef.current.map(event => [event.seq, event]))
    for (const event of incoming) bySeq.set(event.seq, event)
    eventsRef.current = [...bySeq.values()].sort((a, b) => a.seq - b.seq)
    const newest = eventsRef.current[eventsRef.current.length - 1]
    if (newest) cursorRef.current = Math.max(cursorRef.current, newest.seq)
    return toLines(eventsRef.current, roomForLines)
  }

  useEffect(() => {
    let active = true
    setLoading(true); setRoomError(''); setDriver(null)
    // A fresh read owns the thread: stale events from another room must not survive it.
    eventsRef.current = []; cursorRef.current = 0
    void (async () => {
      try {
        // Ask the gateway what it can do before assuming: `driver: false` means no
        // room turn can run here — a different situation from "no room yet".
        const caps = await loadGroupCapabilities(anchor)
        if (active) setDriver(Boolean(caps.driver))
        const rooms = await listGroups(anchor)
        // Address the room by the id the app minted for it, so a same-name re-create
        // on the gateway is never mistaken for the room we already know. Falling back
        // to the name is what lets a group created by another client still be found.
        let found = resolveRoom(rooms, readRoomIds()[group.name], group.name, groupRoomId(group.name))
        // A group's membership rides in the Bots' profiles while its room lives on a
        // gateway, so a group can exist everywhere and have no room here. Opening it on
        // demand is safe because the id is derived from the group name and
        // `groups.create` is idempotent: every client converges on the same room rather
        // than racing to fork one. (If a group is ever deleted and re-created, the room
        // id is re-derived too — so the remembered id, not the name, stays authoritative
        // for the conversation currently open.)
        if (!found && caps.driver) {
          try {
            await createGroup(anchor, {
              roomId: groupRoomId(group.name), name: group.name,
              members: groupMembersFor(group.members.map(name => ({
                name, display_name: profiles.find(item => item.name === name)?.display_name,
              }))),
            })
            found = resolveRoom(await listGroups(anchor), readRoomIds()[group.name], group.name)
          } catch (reason) {
            // Opening a room is a different failure from reading one — name it rather
            // than reporting it through the read path.
            if (active) {
              setRoomError(`Could not open this group’s room: ${reason instanceof Error ? reason.message : 'unknown error'}`)
              setLoading(false)
            }
            return
          }
        }
        if (!active) return
        setRoom(found || null)
        if (!found) { eventsRef.current = []; setLines([]); return }
        // Pin the id the gateway actually holds for this room, so a later open addresses
        // it exactly instead of re-deriving it from a name two rooms could share.
        rememberRoomId(group.name, found.room_id)
        const log = await loadGroupLog(anchor, found.room_id)
        if (active) setLines(mergeEvents(found, log.events || []))
      } catch (reason) {
        if (active) setRoomError(reason instanceof Error ? reason.message : 'Could not read this group’s room.')
      } finally { if (active) setLoading(false) }
    })()
    return () => { active = false }
  }, [anchor, group.name, nonce])

  /**
   * A room's replies are written by the gateway's turn driver *after* the message is
   * accepted, so a thread that is read once shows the question and nothing else until
   * someone refreshes it. While the room is open, read the log from the last seq we hold —
   * `since_seq` makes each read a delta — and appended events land in the thread on their own.
   */
  useEffect(() => {
    if (!room) return
    let active = true
    const poll = async () => {
      try {
        const log = await loadGroupLog(anchor, room.room_id, cursorRef.current)
        const incoming = log.events || []
        if (!active || !incoming.length) return
        setLines(current => {
          const next = mergeEvents(room, incoming)
          return next.length === current.length ? current : next
        })
      } catch { /* a transient read failure must not tear down an open thread */ }
    }
    const timer = window.setInterval(() => void poll(), ROOM_POLL_MS)
    return () => { active = false; window.clearInterval(timer) }
  }, [anchor, room])

  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight }) }, [lines.length])

  // Grow with the draft exactly like the normal conversation composer. Without this
  // the field keeps its single row, the content overflows and the browser draws a
  // scrollbar inside it.
  useEffect(() => {
    const field = composerRef.current
    if (!field) return
    field.style.height = 'auto'
    field.style.height = `${Math.min(field.scrollHeight, 132)}px`
  }, [draft])

  const send = async () => {
    const text = draft.trim()
    if (!text || !room || sending) return
    setSending(true); setSendError('')
    try {
      // `thread_id` ties the message to its turn; `event_id` is the idempotency key.
      await sendGroupMessage(anchor, room.room_id, text, `t-${Date.now().toString(36)}`, `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
      setDraft('')
      // Read the thread back straight away (the user's own message is already in it), then let
      // the open-room poll pick up the members' replies as the driver writes them.
      const log = await loadGroupLog(anchor, room.room_id)
      setLines(mergeEvents(room, log.events || []))
    } catch (reason) {
      setSendError(reason instanceof Error ? reason.message : 'Could not send to this group.')
    } finally { setSending(false) }
  }

  return <main className="app chat-shell" ref={shellRef}>
    <header className={`chat-header${wide ? ' wide-header' : ''}`}>
      {wide
        ? <span className="chat-header-avatar"><span className="group-glyph"><Users size={17}/></span></span>
        : <button className="round-control" onClick={back} aria-label="Back"><ArrowDown size={18} className="back-chevron"/></button>}
      <div className="chat-title"><span className="group-title">{!wide && <span className="group-glyph small"><Users size={16}/></span>}<span><b>{group.name}</b><small>{group.members.length} bots · {memberLine}</small></span></span></div>
      <button className="round-control" onClick={() => setNonce(value => value + 1)} aria-label="Refresh group"><RotateCw size={16}/></button>
    </header>

    <div className="thread-scroll" ref={threadRef}>
      <div className="thread-content">
        {loading && <p className="group-status">Reading the room…</p>}

        {!loading && !room && !roomError && <div className="group-empty">
          <span className="group-glyph"><Users size={20}/></span>
          <b>{group.name}</b>
          <p>{driver === false
            ? 'The gateway this app is connected to reports no group-room driver, so it cannot host this conversation. Its members still see the group; the room needs a gateway that runs the driver.'
            : 'This group has no room on the gateway yet. Its membership lives in the Bots’ own profiles, so every client can see it — the room opens when a member is seated.'}</p>
        </div>}

        {roomError && <p className="group-status error">{roomError}</p>}

        {lines.map(line => {
          if (line.kind === 'user') return <div className="user-row" key={line.key}><div className="user-bubble"><div className="markdown-body"><p>{line.text}</p></div></div></div>
          if (line.kind === 'bot') {
            const profile = profiles.find(item => item.name === memberOf(room, line.memberId)?.profile)
            return <div className="assistant-row" key={line.key}>
              <div className="assistant-message-layout">
                <BotAvatar profile={profile} fallbackName={line.who}/>
                <div className="assistant-message-content">
                  <span className="group-msg-who">{line.who}</span>
                  <div className="markdown-body"><p>{line.text}</p></div>
                </div>
              </div>
            </div>
          }
          return <p className="group-status" key={line.key}>{line.text}</p>
        })}

        {!loading && room && room.members?.length ? <p className="group-status">Members: {room.members.map(member => member.display_name || member.profile).join(', ')}</p> : null}
      </div>
    </div>

    <div className="chat-dock">
      {sendError && <p className="group-status error">{sendError}</p>}
      {!room && !loading && <p className="group-status">{driver === false ? 'This gateway reports no group-room driver, so turns cannot run here.' : 'Messages can be sent once this group has a room on the gateway.'}</p>}
      <div className="ai-composer group-composer">
        <textarea
          ref={composerRef}
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }}
          placeholder={room ? 'Message…  /commands' : 'No room on this gateway yet'}
          disabled={!room}
          rows={1}
        />
        <div className="composer-toolbar">
          <span className="toolbar-spacer"/>
          <button className="composer-send" disabled={!room || !draft.trim() || sending} onClick={() => void send()} aria-label="Send to group"><Send size={15}/></button>
        </div>
      </div>
    </div>
  </main>
}
