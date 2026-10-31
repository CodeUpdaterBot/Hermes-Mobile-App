import { Channel, invoke } from '@tauri-apps/api/core'

/**
 * A browser-shaped WebSocket whose connection lives in Rust (tauri-plugin-websocket).
 *
 * Why: Hermes refuses a gateway WebSocket whose `Origin` is a web origin other than the bound
 * host (`origin_mismatch`, close 4403). The app's WebView origin is `http://tauri.localhost` on
 * Android and Windows, so a WebView WebSocket can never reach a real gateway. A native socket
 * sends no browser Origin; the ticket/token in the URL stays the real auth boundary.
 *
 * The plugin's own JS wrapper attaches listeners only after `connect` resolves, which can drop a
 * frame the server sends immediately (`gateway.ready`). This adapter owns the Channel, so its
 * handler exists before the connection does.
 */
type PluginMessage =
  | { type: 'Text'; data: string }
  | { type: 'Binary'; data: number[] }
  | { type: 'Ping' | 'Pong'; data: number[] }
  | { type: 'Close'; data: { code: number; reason: string } | null }

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
type ChannelFactory = () => { onmessage: ((message: PluginMessage) => void) | undefined }

export class NativeGatewaySocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readyState = NativeGatewaySocket.CONNECTING
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null

  private id: number | null = null
  private readonly decoder = new TextDecoder()

  constructor(
    readonly url: string,
    private readonly call: Invoke = invoke as Invoke,
    makeChannel: ChannelFactory = () => new Channel<PluginMessage>() as unknown as ReturnType<ChannelFactory>,
  ) {
    const channel = makeChannel()
    channel.onmessage = message => this.receive(message)
    this.call<number>('plugin:websocket|connect', { url, onMessage: channel })
      .then(id => {
        this.id = id
        if (this.readyState !== NativeGatewaySocket.CONNECTING) {
          // close() was called while connecting: release the native connection.
          void this.call('plugin:websocket|send', { id, message: { type: 'Close', data: { code: 1000, reason: 'Disconnected by client' } } }).catch(() => {})
          return
        }
        this.readyState = NativeGatewaySocket.OPEN
        this.onopen?.()
      })
      .catch(() => {
        this.readyState = NativeGatewaySocket.CLOSED
        this.onerror?.()
        this.onclose?.({ code: 1006, reason: 'connect failed' })
      })
  }

  private receive(message: PluginMessage) {
    if (this.readyState === NativeGatewaySocket.CLOSED) return
    if (message.type === 'Text') this.onmessage?.({ data: message.data })
    else if (message.type === 'Binary') this.onmessage?.({ data: this.decoder.decode(new Uint8Array(message.data)) })
    else if (message.type === 'Close') {
      this.readyState = NativeGatewaySocket.CLOSED
      this.onclose?.({ code: message.data?.code ?? 1006, reason: message.data?.reason ?? '' })
    }
  }

  send(data: string) {
    if (this.readyState !== NativeGatewaySocket.OPEN || this.id === null) throw new Error('Hermes Gateway is not connected')
    this.call('plugin:websocket|send', { id: this.id, message: { type: 'Text', data } }).catch(() => {
      // A failed write means the stream is gone; report it like a browser socket would.
      if (this.readyState === NativeGatewaySocket.CLOSED) return
      this.readyState = NativeGatewaySocket.CLOSED
      this.onclose?.({ code: 1006, reason: 'send failed' })
    })
  }

  close() {
    if (this.readyState === NativeGatewaySocket.CLOSED || this.readyState === NativeGatewaySocket.CLOSING) return
    const id = this.id
    this.readyState = id === null ? NativeGatewaySocket.CLOSED : NativeGatewaySocket.CLOSING
    if (id !== null) {
      void this.call('plugin:websocket|send', { id, message: { type: 'Close', data: { code: 1000, reason: 'Disconnected by client' } } }).catch(() => {})
    }
    this.readyState = NativeGatewaySocket.CLOSED
    this.onclose?.({ code: 1000, reason: 'Disconnected by client' })
  }
}

/** Native sockets inside the Tauri shell; the browser's WebSocket in a plain web/dev build. */
export function gatewaySocketFactory(url: string): WebSocket {
  const tauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
  return (tauri ? new NativeGatewaySocket(url) : new WebSocket(url)) as unknown as WebSocket
}
