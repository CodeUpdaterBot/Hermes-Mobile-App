export type GatewayPayload = Record<string, unknown>

export type GatewayEvent = {
  type: string
  payload: GatewayPayload
  sessionId?: string
  turnId?: string
  messageId?: string
  seq?: number
  terminal: boolean
}

type JsonRpcFrame = {
  id?: number
  method?: string
  result?: unknown
  error?: { code?: number; message?: string; data?: GatewayPayload }
  params?: GatewayPayload
}

type Pending = {
  method: string
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: number
}

/** A request the host sends to this client (clarify, approvals). */
export type ServerRequest = {
  id: number
  method: string
  params: GatewayPayload
}

export type ServerRequestReply =
  | { result: unknown }
  | { error: { code: number; message: string } }

export class GatewayRpcError extends Error {
  constructor(
    readonly method: string,
    message: string,
    readonly code?: number,
    readonly data: GatewayPayload = {},
  ) {
    super(message)
    this.name = 'GatewayRpcError'
  }

  get safeToResubmit() {
    return this.data.safe_to_resubmit === true
  }
}

const terminalTypes = new Set(['message.complete', 'turn.end', 'turn.error', 'error'])

export function buildSessionResumeParams(sessionId: string, profile?: string): GatewayPayload {
  return { session_id: sessionId, ...(profile ? { profile } : {}) }
}

export function parseGatewayEvent(params: GatewayPayload): GatewayEvent | null {
  if (typeof params.type !== 'string' || !params.type) return null
  const payload = params.payload && typeof params.payload === 'object'
    ? { ...(params.payload as GatewayPayload) }
    : {}
  const sessionId = typeof params.session_id === 'string' ? params.session_id : typeof params.sid === 'string' ? params.sid : undefined
  if (sessionId) payload.session_id = sessionId
  return {
    type: params.type,
    payload,
    sessionId,
    turnId: typeof params.turn_id === 'string' ? params.turn_id : undefined,
    messageId: typeof params.message_id === 'string' ? params.message_id : undefined,
    seq: typeof params.seq === 'number' && params.seq > 0 ? params.seq : undefined,
    terminal: terminalTypes.has(params.type),
  }
}

export type WebSocketFactory = (url: string) => WebSocket

/**
 * One durable Hermes Desktop Gateway connection.
 *
 * Request responses and pushed events are deliberately separate: the
 * prompt.submit response only acknowledges acceptance; terminal turn events
 * own completion. The client never retries a submitted turn automatically.
 */
export class HermesGatewayClient {
  private socket: WebSocket | null = null
  private connecting: Promise<void> | null = null
  private nextId = 1
  private generation = 0
  private readyResolve: (() => void) | null = null
  private readyReject: ((reason: Error) => void) | null = null
  private readonly pending = new Map<number, Pending>()
  private readonly sessionListeners = new Map<string, Set<(event: GatewayEvent) => void>>()
  private readonly activeTurnCancels = new Map<string, () => void>()
  private globalListener?: (event: GatewayEvent) => void
  private requestHandler?: (request: ServerRequest) => Promise<ServerRequestReply>

  constructor(
    private readonly urlFactory: () => Promise<string>,
    private readonly webSocketFactory: WebSocketFactory = url => new WebSocket(url),
  ) {}

  setEventListener(listener?: (event: GatewayEvent) => void) {
    this.globalListener = listener
  }

  /**
   * Register the handler for server-initiated requests (the `clarify` tool and
   * the approval prompts are both server→client). A request carries an `id` *and*
   * a `method`, which is what distinguishes it from a reply to one of our calls;
   * before this existed such frames were dropped and the host waited out its
   * clarify timeout.
   */
  setRequestHandler(handler?: (request: ServerRequest) => Promise<ServerRequestReply>) {
    this.requestHandler = handler
  }

  async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return
    if (this.connecting) return this.connecting
    this.connecting = this.open()
    try {
      await this.connecting
    } finally {
      this.connecting = null
    }
  }

  private async open(): Promise<void> {
    const url = await this.urlFactory()
    const generation = ++this.generation
    const socket = this.webSocketFactory(url)
    this.socket = socket

    const opened = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Hermes Gateway connection timed out')), 15_000)
      socket.onopen = () => { window.clearTimeout(timer); resolve() }
      socket.onerror = () => { window.clearTimeout(timer); reject(new Error('Hermes Gateway connection failed')) }
    })
    const ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve
      this.readyReject = reject
    })

    socket.onmessage = event => this.handleMessage(String(event.data), generation)
    socket.onclose = () => this.handleClose(generation)
    await opened
    await Promise.race([
      ready,
      new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('Hermes Gateway did not announce readiness')), 15_000)),
    ])
  }

  private handleMessage(raw: string, generation: number) {
    if (generation !== this.generation) return
    for (const line of raw.split('\n').filter(Boolean)) {
      let frame: JsonRpcFrame
      try { frame = JSON.parse(line) as JsonRpcFrame } catch { continue }

      if (frame.method === 'event' && frame.params) {
        const event = parseGatewayEvent(frame.params)
        if (!event) continue
        if (event.type === 'gateway.ready') this.readyResolve?.()
        this.globalListener?.(event)
        if (event.sessionId) {
          for (const listener of this.sessionListeners.get(event.sessionId) ?? []) listener(event)
        }
        continue
      }

      // A server→client request carries both an id and a method; a reply to one of
      // our own calls carries an id and no method.
      if (typeof frame.id === 'number' && typeof frame.method === 'string') {
        const request: ServerRequest = { id: frame.id, method: frame.method, params: frame.params ?? {} }
        void this.answerRequest(request)
        continue
      }

      if (typeof frame.id === 'number') {
        const pending = this.pending.get(frame.id)
        if (!pending) continue
        this.pending.delete(frame.id)
        window.clearTimeout(pending.timer)
        if (frame.error) pending.reject(new GatewayRpcError(pending.method, frame.error.message || `${pending.method} failed`, frame.error.code, frame.error.data))
        else pending.resolve(frame.result)
      }
    }
  }

  /**
   * Answer a server request. An unanswered request stalls the host's turn until
   * its timeout, so an unhandled method is refused explicitly instead of ignored.
   */
  private async answerRequest(request: ServerRequest) {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    let reply: ServerRequestReply
    try {
      reply = this.requestHandler ? await this.requestHandler(request) : { error: { code: -32601, message: `Method not found: ${request.method}` } }
    } catch (reason) {
      reply = { error: { code: -32603, message: reason instanceof Error ? reason.message : String(reason) } }
    }
    socket.send(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, ...reply })}\n`)
  }

  private handleClose(generation: number) {
    if (generation !== this.generation) return
    this.generation += 1
    this.socket = null
    const error = new GatewayRpcError('connection', 'Hermes Gateway connection closed', undefined, { reason: 'connection_closed' })
    this.readyReject?.(error)
    this.readyResolve = null
    this.readyReject = null
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    this.sessionListeners.clear()
  }

  async call<T>(method: string, params: GatewayPayload, timeoutMs = 30_000): Promise<T> {
    await this.connect()
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('Hermes Gateway is not connected')
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new GatewayRpcError(method, `${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, { method, resolve: value => resolve(value as T), reject, timer })
      socket.send(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  async resumeSession(sessionId: string, profile?: string): Promise<string> {
    const result = await this.call<{ session_id?: string }>('session.resume', buildSessionResumeParams(sessionId, profile))
    return result.session_id || sessionId
  }

  async submitPrompt(sessionId: string, text: string, listener: (event: GatewayEvent) => void): Promise<void> {
    await this.connect()
    const listeners = this.sessionListeners.get(sessionId) ?? new Set()
    this.sessionListeners.set(sessionId, listeners)

    let settle!: () => void
    let fail!: (reason: Error) => void
    const terminal = new Promise<void>((resolve, reject) => { settle = resolve; fail = reject })
    const terminalListener = (event: GatewayEvent) => {
      listener(event)
      if (!event.terminal) return
      if (event.type === 'error' || event.type === 'turn.error') fail(new GatewayRpcError('prompt.submit', String(event.payload.message || 'Hermes turn failed')))
      else settle()
    }
    listeners.add(terminalListener)
    this.activeTurnCancels.set(sessionId, settle)

    try {
      // An acknowledgement is not completion. Keep listening until a terminal
      // event is received, and never auto-resubmit after an ambiguous failure.
      await this.call('prompt.submit', { session_id: sessionId, text }, 30_000)
      await Promise.race([
        terminal,
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new GatewayRpcError('prompt.submit', 'Hermes turn timed out')), 10 * 60_000)),
      ])
    } finally {
      listeners.delete(terminalListener)
      if (this.activeTurnCancels.get(sessionId) === settle) this.activeTurnCancels.delete(sessionId)
      if (!listeners.size) this.sessionListeners.delete(sessionId)
    }
  }

  attachFile(sessionId: string, input: { name: string; data_url: string; path?: string }) {
    return this.call<{ attached?: boolean; ref_text?: string; name?: string }>('file.attach', {
      session_id: sessionId,
      name: input.name,
      data_url: input.data_url,
      ...(input.path ? { path: input.path } : {}),
    }, 120_000)
  }

  async interruptSession(sessionId: string) {
    const result = await this.call('session.interrupt', { session_id: sessionId })
    this.activeTurnCancels.get(sessionId)?.()
    return result
  }

  setSessionModel(sessionId: string, provider: string, model: string) {
    const providerFlag = provider && provider !== 'custom' ? ` --provider ${provider}` : ''
    return this.call('config.set', {
      session_id: sessionId,
      key: 'model',
      value: `${model}${providerFlag} --session`,
    })
  }

  setSessionReasoning(sessionId: string, effort: string) {
    return this.call('config.set', { session_id: sessionId, key: 'reasoning', value: effort })
  }

  close() {
    const socket = this.socket
    if (!socket) return
    this.handleClose(this.generation)
    socket.close()
  }
}
