import type { ServerRequest, ServerRequestReply } from './gateway'

/**
 * Hermes asks before running a dangerous command: an `approval` server request carrying
 * `{session_id, request_id, command, description, choices?, allow_permanent?, smart_denied?}`.
 * The reply is `{choice}`; anything other than an allow is a deny. Answering "method not
 * found" makes the host withdraw the approval and fail the command, which is why the phone
 * must be able to answer it.
 */
export type ApprovalChoice = 'once' | 'session' | 'always' | 'deny'

export type ApprovalRequest = {
  serverRequestId: number | string
  /** The approval queue's own id; notification actions answer by it. */
  requestId: string | null
  sessionId: string | null
  command: string
  description: string
  choices: ApprovalChoice[]
  smartDenied: boolean
}

export const APPROVAL_CHOICE_LABELS: Record<ApprovalChoice, string> = {
  once: 'Allow once',
  session: 'Allow for this session',
  always: 'Always allow',
  deny: 'Deny',
}

const KNOWN: ApprovalChoice[] = ['once', 'session', 'always', 'deny']
const isChoice = (value: unknown): value is ApprovalChoice => typeof value === 'string' && (KNOWN as string[]).includes(value)
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export function parseApprovalRequest(request: Pick<ServerRequest, 'id' | 'params'>): ApprovalRequest {
  const params = request.params
  const smartDenied = params.smart_denied === true
  let choices: ApprovalChoice[] = Array.isArray(params.choices) ? params.choices.filter(isChoice) : [...KNOWN]
  if (!choices.length) choices = [...KNOWN]
  // The host forbids a permanent allow by sending allow_permanent: false.
  if (params.allow_permanent === false) choices = choices.filter(choice => choice !== 'always')
  // Overriding a smart-deny is always a single operation.
  if (smartDenied) choices = choices.filter(choice => choice === 'once' || choice === 'deny')
  if (!choices.includes('deny')) choices.push('deny')
  return {
    serverRequestId: request.id,
    requestId: text(params.request_id) || null,
    sessionId: text(params.session_id) || null,
    command: text(params.command),
    description: text(params.description) || 'dangerous command',
    choices,
    smartDenied,
  }
}

type Entry = { request: ApprovalRequest; resolve: (reply: ServerRequestReply) => void }

/**
 * Holds the approvals the host is waiting on and settles each exactly once — from the card,
 * a notification action, or the host withdrawing it (`request.cancel`).
 */
export function createApprovalBroker(onChange: (pending: ApprovalRequest[]) => void) {
  const entries = new Map<number | string, Entry>()
  const emit = () => onChange([...entries.values()].map(entry => entry.request))

  const settle = (serverRequestId: number | string, choice: ApprovalChoice): boolean => {
    const entry = entries.get(serverRequestId)
    if (!entry) return false
    entries.delete(serverRequestId)
    entry.resolve({ result: { choice } })
    emit()
    return true
  }

  return {
    handle(request: ServerRequest): Promise<ServerRequestReply> {
      const approval = parseApprovalRequest(request)
      return new Promise<ServerRequestReply>(resolve => {
        entries.set(request.id, { request: approval, resolve })
        // Withdrawn by the host: drop the card. The gateway client never sends this reply.
        request.signal?.addEventListener('abort', () => settle(request.id, 'deny'), { once: true })
        emit()
      })
    },
    answer(serverRequestId: number | string, choice: ApprovalChoice): boolean {
      const entry = entries.get(serverRequestId)
      if (!entry || !entry.request.choices.includes(choice)) return false
      return settle(serverRequestId, choice)
    },
    /** Notification actions only know the approval queue id. */
    answerByRequestId(requestId: string, choice: ApprovalChoice): boolean {
      for (const entry of entries.values()) {
        if (entry.request.requestId === requestId) return this.answer(entry.request.serverRequestId, choice)
      }
      return false
    },
    pending(): ApprovalRequest[] {
      return [...entries.values()].map(entry => entry.request)
    },
  }
}

export type ApprovalBroker = ReturnType<typeof createApprovalBroker>
