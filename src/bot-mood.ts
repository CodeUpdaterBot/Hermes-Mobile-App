/**
 * Bot avatar expressions. Every Bot face has two eyes; what they do says what the Bot is doing.
 *
 * Only the conversation this client has open reports live turn events (tools, streaming,
 * approvals), so that Bot gets a live mood. Every other Bot gets an idle mood from what the
 * roster knows: unread replies make it eager, a long silence makes it sleepy.
 */
import { createContext, useContext } from 'react'

export type BotMood =
  | 'idle'
  | 'sleepy'
  | 'eager'
  | 'thinking'
  | 'working'
  | 'phone'
  | 'writing'
  | 'waiting'
  | 'happy'
  | 'sad'

export type LiveTurn = {
  sending: boolean
  streaming: boolean
  /** Names of tools currently running in the open conversation. */
  runningTools: string[]
  approvalPending: boolean
  error: boolean
  /** The last turn finished successfully moments ago. */
  justFinished: boolean
}

/** Phone-control tools come from the `phone` MCP server (mcp__phone__phone_tap …). */
export const isPhoneTool = (name: string) => /(^|__)phone_[a-z_]+$/.test(name)

/** What the open conversation's Bot is doing right now, most attention-worthy first. */
export function liveMood(turn: LiveTurn): BotMood | null {
  if (turn.approvalPending) return 'waiting'
  if (turn.error && !turn.sending) return 'sad'
  if (turn.sending) {
    if (turn.runningTools.some(isPhoneTool)) return 'phone'
    if (turn.runningTools.length) return 'working'
    if (turn.streaming) return 'writing'
    return 'thinking'
  }
  if (turn.justFinished) return 'happy'
  return null
}

const SLEEPY_AFTER_SECONDS = 12 * 3600

/** A Bot nobody is talking to: eager when it has an unread reply, sleepy after a long silence. */
export function idleMood(lastActiveSeconds: number | undefined, unread: boolean, nowSeconds = Date.now() / 1000): BotMood {
  if (unread) return 'eager'
  if (!lastActiveSeconds || nowSeconds - lastActiveSeconds > SLEEPY_AFTER_SECONDS) return 'sleepy'
  return 'idle'
}

function hash(text: string): number {
  let value = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

/**
 * Each Bot's own rhythm, stable across launches, so a roster of faces never blinks in unison.
 * Values are CSS custom properties consumed by avatar-mood.css.
 */
export function eyeRhythm(name: string): Record<string, string> {
  const seed = hash(name)
  const blinkPeriod = 4.2 + (seed % 37) / 10 // 4.2s – 7.8s
  const blinkDelay = ((seed >>> 8) % 50) / 10 // 0 – 4.9s
  const glancePeriod = 9 + ((seed >>> 16) % 70) / 10 // 9s – 15.9s
  const glanceDelay = ((seed >>> 4) % 60) / 10
  return {
    '--blink-period': `${blinkPeriod.toFixed(1)}s`,
    '--blink-delay': `-${blinkDelay.toFixed(1)}s`,
    '--glance-period': `${glancePeriod.toFixed(1)}s`,
    '--glance-delay': `-${glanceDelay.toFixed(1)}s`,
  }
}

/** Mood per Bot profile name; avatars without an entry just blink. */
export const BotMoodContext = createContext<Record<string, BotMood>>({})
export const useBotMood = (profileName: string | undefined): BotMood | undefined => {
  const moods = useContext(BotMoodContext)
  return profileName ? moods[profileName] : undefined
}

/**
 * Tag the two eye shapes of a Bot face so CSS can blink, wink and move them. Blobatar faces draw
 * the eyes as the last `<g>` (two paths); legacy faces as two ellipses plus catchlights. Anything
 * else is returned unchanged (it simply does not animate). The SVG's size is never touched.
 */
export function withAnimatedEyes(svg: string): string {
  const lastGroup = svg.lastIndexOf('<g ')
  if (lastGroup > 0) {
    const end = svg.indexOf('</g>', lastGroup)
    const group = svg.slice(lastGroup, end)
    const paths = group.match(/<path [^>]*\/>/g)
    if (paths?.length === 2) {
      const open = group.slice(0, group.indexOf('>') + 1).replace('<g ', '<g class="bot-eyes" ')
      const eyes = paths.map((path, index) => `<g class="bot-eye bot-eye-${index ? 'r' : 'l'}">${path}</g>`).join('')
      return svg.slice(0, lastGroup) + open + eyes + svg.slice(end)
    }
  }
  const ellipses = svg.match(/<ellipse [^>]*\/>/g)
  const lights = svg.match(/<circle [^>]*r="0\.65"[^>]*\/>/g)
  if (ellipses?.length === 2 && lights?.length === 2) {
    const start = svg.indexOf(ellipses[0])
    const end = svg.indexOf(lights[1]) + lights[1].length
    const eyes = [0, 1].map(index => `<g class="bot-eye bot-eye-${index ? 'r' : 'l'}">${ellipses[index]}${lights[index]}</g>`).join('')
    return `${svg.slice(0, start)}<g class="bot-eyes">${eyes}</g>${svg.slice(end)}`
  }
  return svg
}
