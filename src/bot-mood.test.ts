import { blobatar } from 'blobatar'
import { describe, expect, it } from 'vitest'

import { canonicalProfileAvatarSvg } from './avatar-render'
import { eyeRhythm, idleMood, isPhoneTool, liveMood, withAnimatedEyes, type LiveTurn } from './bot-mood'

const idleTurn: LiveTurn = { sending: false, streaming: false, runningTools: [], approvalPending: false, error: false, justFinished: false }

describe('live mood of the open conversation', () => {
  it('reads what the turn is doing, most attention-worthy first', () => {
    expect(liveMood(idleTurn)).toBeNull()
    expect(liveMood({ ...idleTurn, sending: true })).toBe('thinking')
    expect(liveMood({ ...idleTurn, sending: true, streaming: true })).toBe('writing')
    expect(liveMood({ ...idleTurn, sending: true, streaming: true, runningTools: ['web_search'] })).toBe('working')
    expect(liveMood({ ...idleTurn, sending: true, runningTools: ['web_search', 'mcp__phone__phone_tap'] })).toBe('phone')
    expect(liveMood({ ...idleTurn, sending: true, runningTools: ['mcp__phone__phone_tap'], approvalPending: true })).toBe('waiting')
    expect(liveMood({ ...idleTurn, justFinished: true })).toBe('happy')
    expect(liveMood({ ...idleTurn, error: true, justFinished: true })).toBe('sad')
  })

  it('recognises phone-control tools by their MCP name', () => {
    expect(isPhoneTool('mcp__phone__phone_open_app')).toBe(true)
    expect(isPhoneTool('phone_screen')).toBe(true)
    expect(isPhoneTool('mcp__homeassistant__call_service')).toBe(false)
    expect(isPhoneTool('telephone')).toBe(false)
  })
})

describe('idle mood of the other Bots', () => {
  const now = 1_800_000_000
  it('is eager with an unread reply, sleepy after a long silence, idle otherwise', () => {
    expect(idleMood(now - 60, true, now)).toBe('eager')
    expect(idleMood(now - 60, false, now)).toBe('idle')
    expect(idleMood(now - 13 * 3600, false, now)).toBe('sleepy')
    expect(idleMood(undefined, false, now)).toBe('sleepy')
  })

  it('gives every Bot its own stable rhythm so faces never blink in unison', () => {
    expect(eyeRhythm('scout')).toEqual(eyeRhythm('scout'))
    expect(eyeRhythm('scout')['--blink-period']).not.toBe(eyeRhythm('pilot')['--blink-period'])
  })
})

describe('animatable eyes', () => {
  it('tags the two eyes of a Blobatar face without changing anything else', () => {
    for (const name of ['scout', 'pilot', 'hearth', 'pantry', 'atlas', 'forge']) {
      const svg = blobatar(name, { background: false })
      const tagged = withAnimatedEyes(svg)
      expect(tagged).toContain('class="bot-eyes"')
      expect(tagged.match(/class="bot-eye bot-eye-[lr]"/g)).toHaveLength(2)
      expect(tagged.replace(/ class="bot-eyes"/, '').replace(/<g class="bot-eye bot-eye-[lr]">(<path [^>]*\/>)<\/g>/g, '$1')).toBe(svg)
      expect(tagged.match(/viewBox="[^"]*"/)?.[0]).toBe(svg.match(/viewBox="[^"]*"/)?.[0])
    }
  })

  it('tags legacy shape faces too', () => {
    const tagged = withAnimatedEyes(canonicalProfileAvatarSvg('gaetan', 'circle', 'hsl(30 68% 58%)'))
    expect(tagged.match(/class="bot-eye bot-eye-[lr]"/g)).toHaveLength(2)
    expect(tagged.match(/<ellipse /g)).toHaveLength(2)
  })

  it('leaves faces it does not understand untouched', () => {
    const odd = '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'
    expect(withAnimatedEyes(odd)).toBe(odd)
  })
})
