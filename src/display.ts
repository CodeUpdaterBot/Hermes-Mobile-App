/**
 * The Bot's own computer, as the wide-screen right-hand column presents it.
 *
 * Contract (tui_gateway/contracts/display.py): `display.status` returns a
 * per-profile runtime + lease snapshot, `display.thumbnail` returns one JPEG grab,
 * and `display.lease_acquire` / `display.lease_release` hand the keyboard and
 * mouse between the agent and the human.
 *
 * The pane's job is to be honest about which of those states the host is in:
 * a Bot whose desktop is not installed, one whose host is out of memory, and one
 * whose screen a human is currently typing on are three different things and must
 * not look like a generic error or a stale screenshot.
 */

export type DisplayLeaseHolder = 'agent' | 'human'

export type DisplayLease = {
  holder: DisplayLeaseHolder
  viewer_hash?: string | null
  since: number
  epoch: number
  reason: string
}

export type DisplayStatus = {
  profile: string
  supported: boolean
  installed: boolean
  missing: string[]
  running: boolean
  pid?: number | null
  display?: string | null
  geometry: string
  install_command?: string | null
  blocker?: string | null
  placement?: string
  lease: DisplayLease
  profile_key: string
}

/**
 * `display.observe`'s answer: the status plus a single-use 30 s ticket for the RFB
 * socket and the `viewer_id` this connection minted.
 *
 * The viewer id is a capability, not a label: `display.lease.acquire` / `release`
 * refuse an id this connection did not mint, and the host's RFB filter only lets
 * keyboard and pointer through from the viewer that currently holds the lease. Open
 * the socket and take control with the SAME id, or the screen stays read-only.
 */
export type DisplayObserve = DisplayStatus & { ticket: string; path: string; viewer_id: string }

/**
 * The RFB socket URL for a minted ticket.
 *
 * The ticket rides in the query string deliberately: noVNC's Websock owns the socket
 * and cannot negotiate a subprotocol or set a header, so a ticket is the only
 * credential this route can be given. It is single-use and expires in 30 s.
 */
export function displaySocketUrl(baseUrl: string, ticket: string, path = '/api/display/ws'): string {
  const origin = baseUrl
    .replace(/\/+$/, '')
    .replace(/^https:\/\//, 'wss://')
    .replace(/^http:\/\//, 'ws://')
  return `${origin}${path}?display_ticket=${encodeURIComponent(ticket)}`
}

/** A viewer id is only worth reusing while the same screen is up. */
export function keepViewerId(status: DisplayStatus | null, viewerId: string | null): string | undefined {
  return displayPaneState(status).kind === 'running' && viewerId ? viewerId : undefined
}

/** What the pane should show, in priority order. */
export type DisplayPaneState =
  | { kind: 'unsupported' }
  | { kind: 'needs-install'; command: string }
  | { kind: 'blocked'; reason: string }
  | { kind: 'stopped' }
  | { kind: 'running'; heldByHuman: boolean; controllable: boolean; watching: boolean }

/**
 * `blocker` outranks `running`: the host refuses to start a display it cannot
 * afford, and the pane should show that reason rather than a Start button that
 * would only fail.
 */
export function displayPaneState(status: DisplayStatus | null): DisplayPaneState {
  if (!status) return { kind: 'unsupported' }
  if (!status.supported) return { kind: 'unsupported' }
  if (!status.installed) return { kind: 'needs-install', command: status.install_command || '' }
  if (status.blocker) return { kind: 'blocked', reason: status.blocker }
  if (!status.running) return { kind: 'stopped' }
  const heldByHuman = status.lease?.holder === 'human'
  return { kind: 'running', heldByHuman, controllable: !heldByHuman, watching: heldByHuman }
}

/** The agent keeps working while a human watches, so taking control is the only switch. */
export function canTakeControl(status: DisplayStatus | null): boolean {
  const state = displayPaneState(status)
  return state.kind === 'running' && state.controllable
}

/**
 * While a human holds the lease the host returns no frame at all, because the
 * screen may show what they are typing. The pane must show the reason instead of
 * the last frame it managed to grab, which would leak that content.
 */
export function thumbnailPolicy(status: DisplayStatus | null, thumbnail: { data_url?: string | null; suppressed?: string | null } | null): { show: string | null; suppressedReason: string } {
  if (status && displayPaneState(status).kind !== 'running') return { show: null, suppressedReason: '' }
  if (!thumbnail) return { show: null, suppressedReason: '' }
  if (!thumbnail.data_url) return { show: null, suppressedReason: thumbnail.suppressed || 'Screen hidden while someone is using it' }
  return { show: thumbnail.data_url, suppressedReason: '' }
}

/** A short line for the pane header, e.g. "Watching" or "You have control". */
export function leaseLabel(status: DisplayStatus | null, thisClientHasLease: boolean): string {
  if (!status) return ''
  if (status.lease?.holder === 'human') return thisClientHasLease ? 'You have control' : 'In use by someone else'
  return 'The Bot has control'
}
