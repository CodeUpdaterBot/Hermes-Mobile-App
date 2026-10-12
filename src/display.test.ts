import { describe, expect, it } from 'vitest'

import { canTakeControl, displayPaneState, displaySocketUrl, keepViewerId, leaseLabel, thumbnailPolicy, type DisplayStatus } from './display'

const base: DisplayStatus = {
  profile: 'inbox-manager',
  supported: true,
  installed: true,
  missing: [],
  running: true,
  geometry: '1280x800',
  lease: { holder: 'agent', since: 1, epoch: 3, reason: '' },
  profile_key: 'inbox-manager',
}

const status = (overrides: Partial<DisplayStatus> = {}): DisplayStatus => ({ ...base, ...overrides })

describe('displayPaneState', () => {
  it('is unsupported when there is no snapshot or the host has no display feature', () => {
    expect(displayPaneState(null)).toEqual({ kind: 'unsupported' })
    expect(displayPaneState(status({ supported: false }))).toEqual({ kind: 'unsupported' })
  })

  it('offers the install command when the desktop is not installed', () => {
    expect(displayPaneState(status({ installed: false, install_command: 'apt install xvnc' })))
      .toEqual({ kind: 'needs-install', command: 'apt install xvnc' })
  })

  it('prefers a blocker over a stopped display, so no failing Start button is shown', () => {
    expect(displayPaneState(status({ running: false, blocker: 'Host is low on memory' })))
      .toEqual({ kind: 'blocked', reason: 'Host is low on memory' })
  })

  it('reports a stopped display as startable', () => {
    expect(displayPaneState(status({ running: false }))).toEqual({ kind: 'stopped' })
  })

  it('reports a running display held by the agent as controllable', () => {
    expect(displayPaneState(status())).toMatchObject({ kind: 'running', heldByHuman: false, controllable: true })
  })

  it('reports a running display held by a human as watch-only', () => {
    expect(displayPaneState(status({ lease: { holder: 'human', since: 1, epoch: 4, reason: '' } })))
      .toMatchObject({ kind: 'running', heldByHuman: true, controllable: false, watching: true })
  })
})

describe('canTakeControl', () => {
  it('is true only for a running, unheld display', () => {
    expect(canTakeControl(status())).toBe(true)
    expect(canTakeControl(status({ running: false }))).toBe(false)
    expect(canTakeControl(status({ lease: { holder: 'human', since: 1, epoch: 4, reason: '' } }))).toBe(false)
    expect(canTakeControl(null)).toBe(false)
  })
})

describe('thumbnailPolicy', () => {
  it('shows the frame while the agent holds the lease', () => {
    expect(thumbnailPolicy(status(), { data_url: 'data:image/jpeg;base64,AAA' }))
      .toEqual({ show: 'data:image/jpeg;base64,AAA', suppressedReason: '' })
  })

  it('never falls back to a stale frame when a human holds the lease', () => {
    // The host withholds the frame because the screen may show what they type.
    const result = thumbnailPolicy(status({ lease: { holder: 'human', since: 1, epoch: 4, reason: '' } }), { data_url: null, suppressed: 'human holds the lease' })
    expect(result.show).toBeNull()
    expect(result.suppressedReason).toBe('human holds the lease')
  })

  it('falls back to a readable reason when the host sends no explanation', () => {
    expect(thumbnailPolicy(status(), { data_url: null }).suppressedReason).toMatch(/hidden/i)
  })

  it('shows nothing at all when the display is not running', () => {
    expect(thumbnailPolicy(status({ running: false }), { data_url: 'data:image/jpeg;base64,AAA' }).show).toBeNull()
  })
})

describe('leaseLabel', () => {
  it('distinguishes our own control from somebody else taking over', () => {
    const human = status({ lease: { holder: 'human', since: 1, epoch: 4, reason: '' } })
    expect(leaseLabel(human, true)).toBe('You have control')
    expect(leaseLabel(human, false)).toBe('In use by someone else')
    expect(leaseLabel(status(), false)).toBe('The Bot has control')
    expect(leaseLabel(null, false)).toBe('')
  })
})

describe('displaySocketUrl', () => {
  // The ticket IS the credential: noVNC's Websock owns the socket and cannot set a
  // header or negotiate a subprotocol, which is why the host mints it into the query.
  it('turns the endpoint into a ws URL and carries the ticket in the query', () => {
    expect(displaySocketUrl('http://100.118.101.75:9119', 'TICKET'))
      .toBe('ws://100.118.101.75:9119/api/display/ws?display_ticket=TICKET')
  })

  it('uses wss for an https endpoint, tolerates a trailing slash and escapes the ticket', () => {
    expect(displaySocketUrl('https://host.example/', 'T/1+2'))
      .toBe('wss://host.example/api/display/ws?display_ticket=T%2F1%2B2')
  })
})

describe('keepViewerId', () => {
  // The lease refuses an id this connection did not mint, so identity must survive a
  // reconnect — but only while it is still the same screen.
  it('keeps the id for a running screen and forgets it otherwise', () => {
    expect(keepViewerId(status(), 'v-1')).toBe('v-1')
    expect(keepViewerId(status({ running: false }), 'v-1')).toBeUndefined()
    expect(keepViewerId(status({ supported: false }), 'v-1')).toBeUndefined()
    expect(keepViewerId(status(), null)).toBeUndefined()
  })
})
