import type { LiveMessage } from './hermes'

export type ReconcileResult = { messages: LiveMessage[]; settled: boolean }

/**
 * How long a running turn may emit nothing before the client stops believing it is watching
 * it. Long enough that a thinking pause or a slow tool is not mistaken for a dead stream.
 */
export const TURN_SILENCE_MS = 7000

/**
 * Fold the host's transcript into what this client is currently showing.
 *
 * The host is the source of truth, and a client can lose a turn's events: a socket that goes
 * half-open over a network or a reconnect that drops the session listeners leaves the app
 * showing a turn that stopped mid-reply, with the finished text sitting on the host and no
 * way to learn that it arrived. Re-reading the conversation is what puts the reply on screen
 * without the user hunting for the refresh button.
 *
 * Rules:
 * - host messages are authoritative and are adopted wholesale (they carry the ids, timestamps
 *   and usage the client cannot synthesise);
 * - a client-only optimistic message is kept, but only while the host has no equivalent — the
 *   host persists the same text with a positive id, and matching on id alone would show it twice;
 * - `settled` reports that the host's transcript now ENDS with an assistant message this client
 *   had not already received, i.e. the turn is over and there is real text to display.
 */
export function reconcileMessages(local: LiveMessage[], loaded: LiveMessage[]): ReconcileResult {
  if (!loaded.length) return { messages: local, settled: false }
  const knownIds = new Set(local.map(message => message.id))
  const optimistic = local.filter(message => message.id < 0
    && !loaded.some(host => host.role === message.role && host.content === message.content))
  const last = loaded[loaded.length - 1]
  const settled = last.role === 'assistant' && !knownIds.has(last.id)
  return { messages: [...loaded, ...optimistic], settled }
}
