import { describe, expect, it } from 'vitest'

import {
  buildCanonicalSessionParams,
  buildUserChatSessionParams,
  isMissingSessionError,
  resolveNewSessionOpenId,
} from './hermes'

describe('new chat session identity', () => {
  it('creates user chats as visible sessions', () => {
    expect(buildUserChatSessionParams('patch')).toEqual({
      profile: 'patch',
      title: 'New chat',
      hidden: false,
      follow_profile_config: true,
    })
  })

  it('keeps canonical Bot Chat birthing hidden', () => {
    expect(buildCanonicalSessionParams('new-bot')).toMatchObject({ hidden: true })
  })

  it('opens new chats with the persisted stored ID, not the runtime ID', () => {
    expect(
      resolveNewSessionOpenId({ session_id: 'runtime-abc', stored_session_id: 'stored-xyz' }),
    ).toBe('stored-xyz')
  })

  it('falls back to the runtime ID when the backend returns a single identity', () => {
    expect(resolveNewSessionOpenId({ session_id: 'runtime-only' })).toBe('runtime-only')
  })

  it('throws a clear error when the backend returns no session identity', () => {
    expect(() => resolveNewSessionOpenId({})).toThrow('Hermes did not return a session')
  })

  it('treats a missing persisted history as an empty brand-new chat, not a load failure', () => {
    expect(isMissingSessionError(new Error('Hermes rejected the request: 404 Not Found'))).toBe(true)
    expect(isMissingSessionError(new Error('unknown session: runtime-abc'))).toBe(true)
    expect(isMissingSessionError(new Error('Could not connect to Hermes Desktop.'))).toBe(false)
    expect(isMissingSessionError('no such session')).toBe(true)
  })
})
