import { afterEach, describe, expect, it, vi } from 'vitest'

import { createApprovalBroker, parseApprovalRequest } from './approvals'
import { HermesGatewayClient, type ServerRequest } from './gateway'

const request = (id: number, params: Record<string, unknown>, signal?: AbortSignal): ServerRequest => ({ id, method: 'approval', params, signal })

describe('approval request parsing', () => {
  it('reads the Hermes approval payload', () => {
    const approval = parseApprovalRequest(request(7, { session_id: 's1', request_id: 'r1', command: 'rm -rf build', description: 'recursive delete' }))
    expect(approval).toEqual({
      serverRequestId: 7, requestId: 'r1', sessionId: 's1', command: 'rm -rf build', description: 'recursive delete',
      choices: ['once', 'session', 'always', 'deny'], smartDenied: false,
    })
  })

  it('drops "always" when the host forbids a permanent allow', () => {
    expect(parseApprovalRequest(request(1, { allow_permanent: false })).choices).toEqual(['once', 'session', 'deny'])
  })

  it('limits a smart-deny override to a single operation', () => {
    expect(parseApprovalRequest(request(1, { smart_denied: true })).choices).toEqual(['once', 'deny'])
  })

  it('honours the host choice list, ignores unknown entries and always offers deny', () => {
    expect(parseApprovalRequest(request(1, { choices: ['once', 'launch-missiles'] })).choices).toEqual(['once', 'deny'])
    expect(parseApprovalRequest(request(1, { choices: [] })).choices).toEqual(['once', 'session', 'always', 'deny'])
  })

  it('falls back to a generic description', () => {
    expect(parseApprovalRequest(request(1, {})).description).toBe('dangerous command')
  })
})

describe('approval broker', () => {
  it('answers the host with the chosen scope and clears the card', async () => {
    const changes: number[] = []
    const broker = createApprovalBroker(pending => changes.push(pending.length))
    const reply = broker.handle(request(3, { request_id: 'r3' }))
    expect(broker.pending()).toHaveLength(1)
    expect(broker.answer(3, 'session')).toBe(true)
    await expect(reply).resolves.toEqual({ result: { choice: 'session' } })
    expect(broker.pending()).toHaveLength(0)
    expect(changes).toEqual([1, 0])
  })

  it('rejects a choice the host did not offer', () => {
    const broker = createApprovalBroker(() => {})
    void broker.handle(request(4, { allow_permanent: false }))
    expect(broker.answer(4, 'always')).toBe(false)
    expect(broker.pending()).toHaveLength(1)
  })

  it('answers by approval request id for notification actions, exactly once', async () => {
    const broker = createApprovalBroker(() => {})
    const reply = broker.handle(request(5, { request_id: 'abc' }))
    expect(broker.answerByRequestId('abc', 'deny')).toBe(true)
    expect(broker.answerByRequestId('abc', 'once')).toBe(false)
    await expect(reply).resolves.toEqual({ result: { choice: 'deny' } })
  })

  it('drops a card the host withdrew', () => {
    const broker = createApprovalBroker(() => {})
    const controller = new AbortController()
    void broker.handle(request(6, { request_id: 'gone' }, controller.signal))
    controller.abort('resolved')
    expect(broker.pending()).toHaveLength(0)
  })
})

class FakeSocket {
  static OPEN = 1
  readyState = 0
  sent: string[] = []
  onopen?: () => void
  onerror?: () => void
  onmessage?: (event: { data: string }) => void
  onclose?: () => void
  send(data: string) { this.sent.push(data) }
  receive(frame: unknown) { this.onmessage?.({ data: `${JSON.stringify(frame)}\n` }) }
}

async function connectedClient() {
  vi.stubGlobal('WebSocket', { OPEN: 1 })
  vi.stubGlobal('window', globalThis)
  const socket = new FakeSocket()
  const client = new HermesGatewayClient(async () => 'ws://test', () => socket as unknown as WebSocket)
  const connecting = client.connect()
  await Promise.resolve()
  await Promise.resolve()
  socket.readyState = 1
  socket.onopen?.()
  await Promise.resolve()
  socket.receive({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready', payload: {} } })
  await connecting
  return { client, socket }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('gateway server requests', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the approval answer back on the socket', async () => {
    const { client, socket } = await connectedClient()
    const broker = createApprovalBroker(() => {})
    client.setRequestHandler(req => broker.handle(req))
    socket.receive({ jsonrpc: '2.0', id: 41, method: 'approval', params: { session_id: 's', request_id: 'r', command: 'ls' } })
    await flush()
    broker.answer(41, 'once')
    await flush()
    expect(socket.sent.map(line => JSON.parse(line))).toContainEqual({ jsonrpc: '2.0', id: 41, result: { choice: 'once' } })
  })

  it('never answers a request the host cancelled', async () => {
    const { client, socket } = await connectedClient()
    const broker = createApprovalBroker(() => {})
    client.setRequestHandler(req => broker.handle(req))
    socket.receive({ jsonrpc: '2.0', id: 42, method: 'approval', params: { session_id: 's', request_id: 'r' } })
    await flush()
    socket.receive({ jsonrpc: '2.0', method: 'event', params: { type: 'request.cancel', session_id: 's', payload: { id: 42, method: 'approval', reason: 'resolved' } } })
    await flush()
    expect(broker.pending()).toHaveLength(0)
    expect(socket.sent.filter(line => JSON.parse(line).id === 42)).toHaveLength(0)
  })

  it('aborts open prompts when the connection closes', async () => {
    const { client, socket } = await connectedClient()
    const broker = createApprovalBroker(() => {})
    client.setRequestHandler(req => broker.handle(req))
    socket.receive({ jsonrpc: '2.0', id: 43, method: 'approval', params: {} })
    await flush()
    socket.onclose?.()
    await flush()
    expect(broker.pending()).toHaveLength(0)
    expect(socket.sent.map(line => JSON.parse(line)).filter(frame => frame.id === 43)).toHaveLength(0)
  })

  it('answers a request carrying a Hermes string id ("srq-…") with that same id', async () => {
    const { client, socket } = await connectedClient()
    const broker = createApprovalBroker(() => {})
    client.setRequestHandler(req => broker.handle(req))
    socket.receive({ jsonrpc: '2.0', id: 'srq-2b82b5f6bbed', method: 'approval', params: { session_id: 'f69355c7', request_id: 'r9', command: 'rm -rf ./x', allow_permanent: true, allow_session: true } })
    await flush()
    expect(broker.pending()).toHaveLength(1)
    expect(broker.answer('srq-2b82b5f6bbed', 'once')).toBe(true)
    await flush()
    expect(socket.sent.map(line => JSON.parse(line))).toContainEqual({ jsonrpc: '2.0', id: 'srq-2b82b5f6bbed', result: { choice: 'once' } })
  })

  it('withdraws a string-id request on request.cancel', async () => {
    const { client, socket } = await connectedClient()
    const broker = createApprovalBroker(() => {})
    client.setRequestHandler(req => broker.handle(req))
    socket.receive({ jsonrpc: '2.0', id: 'srq-cancel-me', method: 'approval', params: { session_id: 's' } })
    await flush()
    socket.receive({ jsonrpc: '2.0', method: 'event', params: { type: 'request.cancel', session_id: 's', payload: { id: 'srq-cancel-me', method: 'approval', reason: 'resolved' } } })
    await flush()
    expect(broker.pending()).toHaveLength(0)
    expect(socket.sent.filter(line => JSON.parse(line).id === 'srq-cancel-me')).toHaveLength(0)
  })

  it('advertises that it answers server requests as soon as the gateway is ready', async () => {
    const { socket } = await connectedClient()
    const frames = socket.sent.map(line => JSON.parse(line))
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ jsonrpc: '2.0', method: 'client.capabilities', params: { server_requests: true } })
  })
})
