import { describe, expect, it } from 'vitest'

import { NativeGatewaySocket } from './native-websocket'

type Handler = ((message: unknown) => void) | undefined

function harness(connect: (args: Record<string, unknown>) => Promise<unknown>) {
  const channel: { onmessage: Handler } = { onmessage: undefined }
  const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = []
  const call = (<T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    calls.push({ cmd, args })
    if (cmd === 'plugin:websocket|connect') return connect(args ?? {}) as Promise<T>
    return Promise.resolve(undefined as T)
  })
  const socket = new NativeGatewaySocket('ws://host/api/ws?ticket=t', call, () => channel as never)
  return { socket, channel, calls }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('native gateway socket', () => {
  it('delivers a frame the server sends before connect resolves (gateway.ready race)', async () => {
    let finish!: (id: number) => void
    const { socket, channel } = harness(() => new Promise(resolve => { finish = resolve as (id: number) => void }))
    const received: string[] = []
    socket.onmessage = event => received.push(event.data)
    channel.onmessage?.({ type: 'Text', data: '{"method":"event","params":{"type":"gateway.ready"}}' })
    finish(7)
    await flush()
    expect(received).toHaveLength(1)
    expect(socket.readyState).toBe(NativeGatewaySocket.OPEN)
  })

  it('opens, sends text frames by connection id and passes the URL through', async () => {
    const { socket, calls } = harness(() => Promise.resolve(3))
    let opened = false
    socket.onopen = () => { opened = true }
    await flush()
    expect(opened).toBe(true)
    socket.send('{"id":1}\n')
    expect(calls[0]).toMatchObject({ cmd: 'plugin:websocket|connect', args: { url: 'ws://host/api/ws?ticket=t' } })
    expect(calls[1]).toEqual({ cmd: 'plugin:websocket|send', args: { id: 3, message: { type: 'Text', data: '{"id":1}\n' } } })
  })

  it('reports a failed connect as error + close, like a browser socket', async () => {
    const { socket } = harness(() => Promise.reject(new Error('refused')))
    const events: string[] = []
    socket.onerror = () => events.push('error')
    socket.onclose = event => events.push(`close:${event.code}`)
    await flush()
    expect(events).toEqual(['error', 'close:1006'])
    expect(() => socket.send('x')).toThrow()
  })

  it('surfaces a server close frame once', async () => {
    const { socket, channel } = harness(() => Promise.resolve(1))
    const closes: number[] = []
    socket.onclose = event => closes.push(event.code)
    await flush()
    channel.onmessage?.({ type: 'Close', data: { code: 4403, reason: 'origin' } })
    channel.onmessage?.({ type: 'Text', data: 'late' })
    expect(closes).toEqual([4403])
    expect(socket.readyState).toBe(NativeGatewaySocket.CLOSED)
  })

  it('closes the native connection when closed by the client', async () => {
    const { socket, calls } = harness(() => Promise.resolve(9))
    await flush()
    socket.close()
    expect(calls.at(-1)).toEqual({ cmd: 'plugin:websocket|send', args: { id: 9, message: { type: 'Close', data: { code: 1000, reason: 'Disconnected by client' } } } })
    expect(socket.readyState).toBe(NativeGatewaySocket.CLOSED)
  })

  it('decodes binary text frames', async () => {
    const { socket, channel } = harness(() => Promise.resolve(2))
    const received: string[] = []
    socket.onmessage = event => received.push(event.data)
    await flush()
    channel.onmessage?.({ type: 'Binary', data: [...new TextEncoder().encode('hi')] })
    expect(received).toEqual(['hi'])
  })
})
