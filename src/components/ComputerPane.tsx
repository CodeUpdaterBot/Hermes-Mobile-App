import { useEffect, useRef, useState } from 'react'
import { Copy, Monitor, MousePointerClick, Play, RotateCw, X } from 'lucide-react'

import { displayPaneState, leaseLabel, thumbnailPolicy, type DisplayStatus } from '../display'
import { acquireDisplayLease, grabDisplayThumbnail, loadDisplayStatus, releaseDisplayLease, startDisplay } from '../hermes'

type Props = { profile: string; botName: string; onClose: () => void }

const THUMBNAIL_INTERVAL_MS = 4000

/**
 * The right-hand column on a wide screen: the Bot's own computer.
 *
 * The host withholds the frame while a human holds the lease, so this pane never
 * keeps showing the last image it managed to grab — it says why the screen is
 * hidden instead. Every host state (unsupported, not installed, blocked, stopped,
 * running) has its own presentation rather than collapsing into a generic error.
 */
export function ComputerPane({ profile, botName, onClose }: Props) {
  const [status, setStatus] = useState<DisplayStatus | null>(null)
  const [thumbnail, setThumbnail] = useState<{ data_url?: string | null; suppressed?: string | null } | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  // Tracked locally: the host never reveals another viewer's id, so only we know
  // whether this client is the one that took control.
  const tookControlRef = useRef(false)
  const epochRef = useRef(0)

  const refresh = async () => {
    const epoch = ++epochRef.current
    try {
      const next = await loadDisplayStatus(profile)
      if (epoch !== epochRef.current) return
      setStatus(next)
      const state = displayPaneState(next)
      if (state.kind === 'running') {
        const frame = await grabDisplayThumbnail(profile)
        if (epoch === epochRef.current) setThumbnail(frame)
      } else {
        setThumbnail(null)
      }
    } catch {
      // A host without the display feature, or a dropped socket: the column
      // simply does not offer a computer view.
      if (epoch === epochRef.current) setStatus(null)
    }
  }

  useEffect(() => { void refresh() }, [profile])

  const state = displayPaneState(status)
  const running = state.kind === 'running'
  const heldByHuman = running && state.heldByHuman
  const thisClientHasLease = heldByHuman && tookControlRef.current

  // Poll only while there is something worth watching, and never while a human
  // holds the lease — the host would return nothing anyway.
  useEffect(() => {
    if (!running || heldByHuman) return
    const timer = window.setInterval(() => { void refresh() }, THUMBNAIL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [running, heldByHuman, profile])

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

  const takeControl = () => run('take', async () => { await acquireDisplayLease(profile); tookControlRef.current = true })
  const release = () => run('release', async () => { await releaseDisplayLease(profile); tookControlRef.current = false })

  const frame = thumbnailPolicy(status, thumbnail)

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
      <div className={`computer-frame ${frame.show ? '' : 'empty'}`}>
        {frame.show ? <img src={frame.show} alt={`${botName}'s screen`}/> : <span>{frame.suppressedReason || 'Waiting for the first frame…'}</span>}
      </div>
      <div className="computer-lease"><span className={`computer-dot ${heldByHuman ? 'human' : 'agent'}`}/><b>{leaseLabel(status, thisClientHasLease)}</b></div>
      <div className="computer-actions">
        {thisClientHasLease
          ? <button className="secondary wide" disabled={Boolean(busy)} onClick={() => void release()}>{busy === 'release' ? 'Releasing…' : 'Release control'}</button>
          : <button className="primary wide" disabled={Boolean(busy) || heldByHuman} onClick={() => void takeControl()}>{busy === 'take' ? 'Taking control…' : <><MousePointerClick size={15}/> Take control</>}</button>}
      </div>
      {heldByHuman && !thisClientHasLease && <p className="computer-note">Someone has control right now, so the screen stays private.</p>}
    </>}

    {error && <p className="computer-note warn">{error}</p>}
  </aside>
}
