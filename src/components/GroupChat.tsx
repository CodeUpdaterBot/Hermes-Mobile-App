import { useEffect, useRef, useState } from 'react'
import { ArrowDown, RotateCw, Send, Users } from 'lucide-react'

import type { GroupEvent, GroupMember, GroupRoom, LiveProfile } from '../hermes'
import { createGroup, listGroups, loadGroupCapabilities, loadGroupLog, sendGroupMessage } from '../hermes'
import type { BotGroup } from '../groups'
import { newGroupRoomId } from '../groups'
import { BotAvatar } from './BotAvatar'

type Props = { group: BotGroup; profiles: LiveProfile[]; wide?: boolean; back: () => void }

type Line =
  | { kind: 'user'; key: string; text: string }
  | { kind: 'bot'; key: string; text: string; who: string; profile?: LiveProfile; memberId?: string }
  | { kind: 'status'; key: string; text: string }

const titleize = (value: string) => value.split(/[-_]+/).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join(' ')

/** A `message.member` reply is attributed by `member_id` → the room's roster. */
function memberOf(room: GroupRoom | null, memberId?: string): GroupMember | undefined {
  return (room?.members || []).find(member => member.member_id === memberId)
}

function toLines(events: GroupEvent[], room: GroupRoom | null): Line[] {
  const lines: Line[] = []
  for (const event of events) {
    const payload = event.payload || {}
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
  // The room service is profile-scoped; any member's profile addresses the room.
  const anchor = group.members[0]
  const memberLine = group.members.map(name => titleize(name)).join(', ')

  useEffect(() => {
    let active = true
    setLoading(true); setRoomError(''); setDriver(null)
    void (async () => {
      try {
        // Ask the gateway what it can do before assuming: `driver: false` means no
        // room turn can run here — a different situation from "no room yet".
        const caps = await loadGroupCapabilities(anchor)
        if (active) setDriver(Boolean(caps.driver))
        let rooms = await listGroups(anchor)
        let found = rooms.find(item => item.name === group.name)
        // Membership rides in the Bots' profiles but a room lives on a gateway, so a
        // group can be visible everywhere and still have no room. Open it here when
        // the gateway can drive one — idempotent, so a retry cannot fork the room.
        if (!found && caps.driver) {
          await createGroup(anchor, {
            roomId: newGroupRoomId(group.name), name: group.name,
            members: group.members.map(name => ({ profile: name, handle: name })),
          })
          rooms = await listGroups(anchor)
          found = rooms.find(item => item.name === group.name)
        }
        if (!active) return
        setRoom(found || null)
        if (!found) { setLines([]); return }
        const log = await loadGroupLog(anchor, found.room_id)
        if (active) setLines(toLines(log.events || [], found))
      } catch (reason) {
        if (active) setRoomError(reason instanceof Error ? reason.message : 'Could not read this group’s room.')
      } finally { if (active) setLoading(false) }
    })()
    return () => { active = false }
  }, [anchor, group.name, nonce])

  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight }) }, [lines.length])

  const send = async () => {
    const text = draft.trim()
    if (!text || !room || sending) return
    setSending(true); setSendError('')
    try {
      // `thread_id` is client-generated and groups the message with its turn.
      await sendGroupMessage(anchor, room.room_id, text, `t-${Date.now().toString(36)}`)
      setDraft('')
      const log = await loadGroupLog(anchor, room.room_id)
      setLines(toLines(log.events || [], room))
    } catch (reason) {
      setSendError(reason instanceof Error ? reason.message : 'Could not send to this group.')
    } finally { setSending(false) }
  }

  return <main className="app chat-shell">
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
      <div className="ai-composer">
        <textarea
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }}
          placeholder={room ? `Message ${group.name}… (@name to direct, @everyone for all)` : 'No room on this gateway yet'}
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
