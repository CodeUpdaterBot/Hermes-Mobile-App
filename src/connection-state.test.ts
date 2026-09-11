import { describe, expect, it } from 'vitest'

import { errorMessage, gatewayNeedsHttps, RequestEpoch, selectRestoredEndpoint, supportsBasicAuth } from './connection-state'

describe('connection state', () => {
  it('prefers the native lifecycle-safe endpoint over legacy browser storage', () => {
    expect(selectRestoredEndpoint('http://100.118.101.75:9119/', 'http://old:9119', 'http://127.0.0.1:9119'))
      .toBe('http://100.118.101.75:9119')
  })

  it('preserves string rejections from Tauri instead of hiding diagnostics', () => {
    expect(errorMessage('Hermes rejected WebSocket ticket: 401 Unauthorized', 'generic'))
      .toBe('Hermes rejected WebSocket ticket: 401 Unauthorized')
  })

  it('recognizes the Hermes basic provider for in-app sign-in', () => {
    expect(supportsBasicAuth(['basic'])).toBe(true)
    expect(supportsBasicAuth([{ name: 'basic' }])).toBe(true)
    expect(supportsBasicAuth(['nous'])).toBe(false)
  })

  it('rejects a stale loopback refresh after a newer pairing attempt begins', () => {
    const epochs = new RequestEpoch()
    const staleLoopback = epochs.begin()
    const currentPairing = epochs.begin()
    expect(epochs.isCurrent(staleLoopback)).toBe(false)
    expect(epochs.isCurrent(currentPairing)).toBe(true)
  })

  it('flags plain-http remote gateways in a secure context', () => {
    expect(gatewayNeedsHttps('http://100.118.101.75:9119', true)).toBe(true)
    expect(gatewayNeedsHttps('http://your-pc.tailnet.ts.net:9119', true)).toBe(true)
  })

  it('allows https remote gateways in a secure context', () => {
    expect(gatewayNeedsHttps('https://your-pc.tailnet.ts.net:9119', true)).toBe(false)
  })

  it('allows loopback gateways over http in a secure context', () => {
    expect(gatewayNeedsHttps('http://localhost:9119', true)).toBe(false)
    expect(gatewayNeedsHttps('http://127.0.0.1:9119', true)).toBe(false)
    expect(gatewayNeedsHttps('http://[::1]:9119', true)).toBe(false)
  })

  it('treats the loopback hostname case-insensitively', () => {
    expect(gatewayNeedsHttps('http://LOCALHOST:9119', true)).toBe(false)
    expect(gatewayNeedsHttps('http://LocalHost:9119', true)).toBe(false)
  })

  it('does not flag plain-http gateways outside a secure context', () => {
    expect(gatewayNeedsHttps('http://100.118.101.75:9119', false)).toBe(false)
    expect(gatewayNeedsHttps('http://your-pc.tailnet.ts.net:9119', false)).toBe(false)
  })
})
