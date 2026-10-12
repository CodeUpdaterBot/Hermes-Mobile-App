import { describe, expect, it } from 'vitest'

import type { LiveMessage } from './hermes'
import { reconcileMessages } from './chat-reconcile'

const user = (id: number, content = 'what are your specialties?'): LiveMessage => ({ id, role: 'user', content })
const bot = (id: number, content = 'I watch for signals.'): LiveMessage => ({ id, role: 'assistant', content })

describe('reconcileMessages', () => {
  it('adopts the host transcript and reports the turn finished', () => {
    const local = [user(-1), bot(1, 'I was mid-')]
    const result = reconcileMessages(local, [user(7), bot(8)])
    expect(result.settled).toBe(true)
    expect(result.messages).toEqual([user(7), bot(8)])
  })

  // The optimistic bubble the user typed exists only on this client until the host persists
  // it, so it must survive — but once the host HAS it, matching on id alone would show the
  // question twice.
  it('keeps an unpersisted optimistic message', () => {
    const result = reconcileMessages([user(-1, 'still only here')], [bot(9)])
    expect(result.messages).toEqual([bot(9), user(-1, 'still only here')])
  })

  it('drops the optimistic duplicate once the host carries the same message', () => {
    const result = reconcileMessages([user(-1, 'same text')], [user(4, 'same text'), bot(5)])
    expect(result.messages).toEqual([user(4, 'same text'), bot(5)])
  })

  // Mid-turn the host's transcript still ends with the user's own message: nothing has
  // finished, so the watchdog must keep waiting instead of settling an empty reply.
  it('does not settle while the host has not produced a reply', () => {
    const result = reconcileMessages([user(-1)], [user(4)])
    expect(result.settled).toBe(false)
    expect(result.messages).toEqual([user(4)])
  })

  // A reply this client already received is not news, so re-reading must not re-settle it.
  it('does not settle on a reply the client already holds', () => {
    const local = [user(4), bot(5)]
    const result = reconcileMessages(local, [user(4), bot(5)])
    expect(result.settled).toBe(false)
  })

  it('leaves the transcript alone when the host returns nothing', () => {
    const local = [user(-1)]
    expect(reconcileMessages(local, [])).toEqual({ messages: local, settled: false })
  })
})
