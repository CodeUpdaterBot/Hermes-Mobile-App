import { useEffect, useRef, useState } from 'react'

import type RFB from '@novnc/novnc'

/**
 * noVNC is loaded on demand, never with the app shell: its module runs a top-level `await`
 * WebCodecs H.264 probe whose `VideoDecoder.flush()` never settles on some hardware decoders
 * (Galaxy Z Fold7, Android 17). As a static import that hung the whole module graph and the
 * app never rendered. The deadline turns any remaining hang into a pane error.
 */
const NOVNC_LOAD_DEADLINE_MS = 8_000
let novnc: Promise<typeof RFB> | null = null
function loadNoVnc(): Promise<typeof RFB> {
  novnc ??= Promise.race([
    import('@novnc/novnc').then(module => module.default),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('The screen viewer could not start on this device.')), NOVNC_LOAD_DEADLINE_MS)),
  ]).catch(reason => { novnc = null; throw reason })
  return novnc
}

type Props = {
  /** `ws(s)://…/api/display/ws?display_ticket=…` — single-use, minted per connection. */
  url: string
  /** Whether this client currently holds the lease. The host enforces it independently. */
  control: boolean
  /** The host closes an evicted viewer with code 4000 `control-taken`. */
  onControlTaken: () => void
  /** A failure that needs a new ticket or a new screen, rather than a reconnect. */
  onFatal: (message: string) => void
}

/**
 * The live view of a Bot's screen: raw RFB over a WebSocket, rendered by noVNC.
 *
 * This is the whole point of the pane. Polling `display.thumbnail` every few seconds
 * shows a still image that is always behind, and it can never carry input — mouse and
 * keyboard only travel on this socket, and only from the viewer that holds the lease.
 */
export function DisplayViewer({ url, control, onControlTaken, onFatal }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const rfbRef = useRef<RFB | null>(null)
  const [live, setLive] = useState(false)

  useEffect(() => {
    const target = hostRef.current
    if (!target) return
    setLive(false)
    let cancelled = false
    let teardown = () => {}
    void loadNoVnc().then(RFBClient => {
      if (cancelled) return
      // noVNC's Websock owns the socket and cannot negotiate a subprotocol or set a
      // header, which is exactly why the host mints a single-use ticket into the query.
      const rfb = new RFBClient(target, url)
      rfb.scaleViewport = true
      rfb.dragViewport = true
      rfb.background = '#0b0d12'
      rfb.viewOnly = !control

      const onConnect = () => setLive(true)
      const onDisconnect = (event: { detail?: { clean?: boolean; code?: number; reason?: string } }) => {
        setLive(false)
        const code = event.detail?.code
        if (code === 4000) { onControlTaken(); return }
        if (event.detail?.clean === false) onFatal(event.detail?.reason || 'The screen stream ended unexpectedly.')
      }
      const onSecurity = () => onFatal('The host refused that screen ticket. Reopen the pane to mint a new one.')

      rfb.addEventListener('connect', onConnect)
      rfb.addEventListener('disconnect', onDisconnect)
      rfb.addEventListener('securityfailure', onSecurity)
      rfbRef.current = rfb
      teardown = () => {
        rfb.removeEventListener('connect', onConnect)
        rfb.removeEventListener('disconnect', onDisconnect)
        rfb.removeEventListener('securityfailure', onSecurity)
        rfb.disconnect()
        rfbRef.current = null
      }
    }).catch(reason => { if (!cancelled) onFatal(reason instanceof Error ? reason.message : String(reason)) })
    return () => { cancelled = true; teardown() }
  }, [url])

  // Taking control must not require a reconnect: the server re-reads the lease between
  // input events, so flipping this is enough to start and stop sending them.
  useEffect(() => { if (rfbRef.current) rfbRef.current.viewOnly = !control }, [control])

  return <div className={`display-viewer${live ? ' live' : ''}`} ref={hostRef}/>
}
