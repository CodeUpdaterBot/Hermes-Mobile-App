import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Monitor, MousePointerClick, Play, RotateCw, X } from 'lucide-react'

import { displayPaneState, displaySocketUrl, keepViewerId, leaseLabel, type DisplayStatus } from '../display'
import { acquireDisplayLease, activeHermesEndpoint, grabDisplayThumbnail, loadDisplayStatus, observeDisplay, releaseDisplayLease, startDisplay } from '../hermes'
import { DisplayViewer } from './DisplayViewer'

type Props = { profile: string; botName: string; onClose: () => void }

const STATUS_INTERVAL_MS = 4000

/**
 * The right-hand column on a wide screen: the Bot's own computer.
 *
 * The screen is raw RFB over `/api/display/ws`, rendered live by `DisplayViewer`.
 * Watching is enough to look; typing and pointing need the takeover lease, and the
 * host grants that only to a `viewer_id` it minted for this connection — so the
 * ticket and the lease are always taken together, from one `display.observe`.
 *
 * Every host state (unsupported, not installed, blocked, stopped, running) has its
 * own presentation rather than collapsing into a generic error, and while a human
 * holds control the pane covers the last frame instead of leaving it on screen.
 */
export function ComputerPane({ profile, botName, onClose }: Props) {
  const [status, setStatus] = useState<DisplayStatus | null>(null)
  const [session, setSession] = useState<{ url: string; viewerId: string } | null>(null)
  const [poster, setPoster] = useState<string | null>(null)
  const [streamError, setStreamError] = useState('')
  const [attachKey, setAttachKey] = useState(0)
  const [tookControl, setTookControl] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const statusRef = useRef<DisplayStatus | null>(null)
  const viewerIdRef = useRef<string | null>(null)
  const tookControlRef = useRef(false)
  const epochRef = useRef(0)

  const state = displayPaneState(status)
  const running = state.kind === 'running'
  const heldByHuman = running && state.heldByHuman
  const thisClientHasLease = heldByHuman && tookControl

  const refresh = useCallback(async () => {
    const epoch = ++epochRef.current
    try {
      const next = await loadDisplayStatus(profile)
      if (epoch !== epochRef.current) return
      statusRef.current = next
      setStatus(next)
    } catch {
      // A host without the display feature, or a dropped socket: the column simply
      // does not offer a computer view.
      if (epoch === epochRef.current) setStatus(null)
    }
  }, [profile])

  useEffect(() => { void refresh() }, [refresh])

  // Poll while a screen is up, so a takeover from another client (or from Hermes
  // Desktop) is reflected here. A stopped screen needs no polling.
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => { void refresh() }, STATUS_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [running, refresh])

  /**
   * Mint a ticket and open the stream, once per running screen.
   *
   * The ticket is single-use and lives 30 s, so it is minted here rather than held;
   * `attachKey` changes when the socket was closed out from under us and a new one is
   * needed. Passing the id this connection already minted keeps our identity across
   * that reconnect instead of arriving as a stranger.
   */
  useEffect(() => {
    if (!running) {
      setSession(null)
      setPoster(null)
      setStreamError('')
      tookControlRef.current = false
      setTookControl(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const observed = await observeDisplay(profile, keepViewerId(statusRef.current, viewerIdRef.current))
        if (cancelled) return
        viewerIdRef.current = observed.viewer_id
        setStreamError('')
        setSession({ url: displaySocketUrl(activeHermesEndpoint(), observed.ticket, observed.path), viewerId: observed.viewer_id })
      } catch (reason) {
        if (!cancelled) setStreamError(reason instanceof Error ? reason.message : String(reason))
      }
    })()
    // A still frame covers the moment before the first RFB paint lands.
    void grabDisplayThumbnail(profile)
      .then(frame => { if (!cancelled && frame.data_url) setPoster(frame.data_url) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [running, profile, attachKey])

  // Hand the agent back if this client is the one holding control: a human lease left
  // behind is a screen nobody can drive.
  useEffect(() => () => {
    if (tookControlRef.current && viewerIdRef.current) void releaseDisplayLease(profile, viewerIdRef.current).catch(() => {})
  }, [profile])

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label)
    setError('')
    try {
      await action()
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy('')
    }
  }

  const takeControl = () => run('take', async () => {
    if (!viewerIdRef.current) throw new Error('Reopen this pane: this connection has no screen ticket yet.')
    await acquireDisplayLease(profile, viewerIdRef.current)
    tookControlRef.current = true
    setTookControl(true)
  })

  const release = () => run('release', async () => {
    if (viewerIdRef.current) await releaseDisplayLease(profile, viewerIdRef.current)
    tookControlRef.current = false
    setTookControl(false)
  })

  // The host evicted this viewer: control went to someone else and the socket was
  // closed, so drop back to watching with a fresh ticket.
  const onControlTaken = () => {
    tookControlRef.current = false
    setTookControl(false)
    setAttachKey(key => key + 1)
  }

  return <aside className="computer-pane" aria-label={`${botName}'s computer`}>
    <header className="computer-head">
      <Monitor size={15}/>
      <b>{botName}&rsquo;s computer</b>
      <button className="round-control" onClick={() => void refresh()} aria-label="Refresh screen"><RotateCw size={14}/></button>
      <button className="round-control" onClick={onClose} aria-label="Close computer view"><X size={14}/></button>
    </header>

    {state.kind === 'unsupported' && <p className="computer-note">This Bot has no desktop on the host.</p>}

    {state.kind === 'needs-install' && <div className="computer-note">
      <p>The desktop tools are not installed on the host.</p>
      {state.command && <button className="computer-command" onClick={() => { void navigator.clipboard.writeText(state.command).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1400) }) }}><Copy size={13}/><code>{state.command}</code><span>{copied ? 'Copied' : 'Copy'}</span></button>}
    </div>}

    {state.kind === 'blocked' && <p className="computer-note warn">{state.reason}</p>}

    {state.kind === 'stopped' && <div className="computer-note">
      <p>The Bot&rsquo;s screen is stopped.</p>
      <button className="primary wide" disabled={busy === 'start'} onClick={() => void run('start', () => startDisplay(profile))}>{busy === 'start' ? 'Starting…' : <><Play size={15}/> Start screen</>}</button>
    </div>}

    {running && <>
      <div className={`computer-frame ${session ? '' : 'empty'}`}>
        {session
          ? <DisplayViewer url={session.url} control={thisClientHasLease} onControlTaken={onControlTaken} onFatal={setStreamError}/>
          : poster
            ? <img src={poster} alt={`${botName}'s screen`}/>
            : <span>Connecting to the screen…</span>}
        {/* The host withholds frames while someone else is typing, so covering the last
            one is what keeps that content private rather than merely stale. */}
        {heldByHuman && !thisClientHasLease && <div className="display-cover"><span>Someone has control right now, so the screen stays private.</span></div>}
      </div>
      <div className="computer-lease"><span className={`computer-dot ${heldByHuman ? 'human' : 'agent'}`}/><b>{leaseLabel(status, thisClientHasLease)}</b></div>
      <div className="computer-actions">
        {thisClientHasLease
          ? <button className="secondary wide" disabled={Boolean(busy)} onClick={() => void release()}>{busy === 'release' ? 'Releasing…' : 'Release control'}</button>
          : <button className="primary wide" disabled={Boolean(busy) || heldByHuman || !session} onClick={() => void takeControl()}>{busy === 'take' ? 'Taking control…' : <><MousePointerClick size={15}/> Take control</>}</button>}
      </div>
      {heldByHuman && !thisClientHasLease && <p className="computer-note">Someone has control right now, so the screen stays private.</p>}
    </>}

    {streamError && <p className="computer-note warn">{streamError}</p>}
    {error && <p className="computer-note warn">{error}</p>}
  </aside>
}
