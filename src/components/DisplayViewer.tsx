import { useEffect, useRef, useState } from 'react'

import RFB from '@novnc/novnc'

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
    // noVNC's Websock owns the socket and cannot negotiate a subprotocol or set a
    // header, which is exactly why the host mints a single-use ticket into the query.
    const rfb = new RFB(target, url)
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
    return () => {
      rfb.removeEventListener('connect', onConnect)
      rfb.removeEventListener('disconnect', onDisconnect)
      rfb.removeEventListener('securityfailure', onSecurity)
      rfb.disconnect()
      rfbRef.current = null
    }
  }, [url])

  // Taking control must not require a reconnect: the server re-reads the lease between
  // input events, so flipping this is enough to start and stop sending them.
  useEffect(() => { if (rfbRef.current) rfbRef.current.viewOnly = !control }, [control])

  return <div className={`display-viewer${live ? ' live' : ''}`} ref={hostRef}/>
}
