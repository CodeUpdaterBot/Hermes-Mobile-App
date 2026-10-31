import { useEffect, useMemo, useState, type CSSProperties } from 'react'

import { canonicalProfileAvatarSvg } from '../avatar-render'
import { eyeRhythm, useBotMood, withAnimatedEyes, type BotMood } from '../bot-mood'
import { loadProfileAvatar, type LiveProfile } from '../hermes'

export type BotAvatarVariant = 'roster' | 'session' | 'header' | 'welcome' | 'mention' | 'message'

type Props = {
  profile?: LiveProfile
  fallbackName: string
  variant?: BotAvatarVariant
  /** Overrides the Bot's current mood (otherwise read from BotMoodContext). */
  mood?: BotMood
  /** A transcript avatar that belongs to the reply being written, so it follows the live mood. */
  live?: boolean
}

const initials = (name: string) => name.split(/[-_ ]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase()

export const shouldLoadAvatarAsset = (profile?: LiveProfile) => Boolean(profile?.has_avatar && profile.ui_meta?.['hermes-bots']?.imageKind !== 'shape')

// Transcript and mention avatars repeat many times on screen, so only the live one reacts.
const QUIET_VARIANTS: BotAvatarVariant[] = ['message', 'mention']

export function BotAvatar({ profile, fallbackName, variant = 'roster', mood: moodOverride, live = false }: Props) {
  const [asset, setAsset] = useState<string | null>(null)
  const meta = profile?.ui_meta?.['hermes-bots']
  const svg = useMemo(() => profile ? withAnimatedEyes(canonicalProfileAvatarSvg(profile.name, meta?.shape, meta?.color)) : '', [profile?.name, meta?.shape, meta?.color])
  const contextMood = useBotMood(profile?.name)
  const mood = moodOverride ?? (QUIET_VARIANTS.includes(variant) && !live ? undefined : contextMood)
  const rhythm = useMemo(() => eyeRhythm(profile?.name ?? fallbackName) as CSSProperties, [profile?.name, fallbackName])
  const className = `bot-avatar-slot bot-avatar-${variant}`

  useEffect(() => {
    let active = true
    setAsset(null)
    if (!profile || !shouldLoadAvatarAsset(profile)) return () => { active = false }
    void loadProfileAvatar(profile.name).then(value => { if (active) setAsset(value) }).catch(() => undefined)
    return () => { active = false }
  }, [profile?.name, profile?.has_avatar, meta?.imageKind])

  if (!profile) return <span className={`avatar-fallback ${className}`}>{initials(fallbackName)}</span>
  if (asset || meta?.image) return <img className={`avatar-fallback bot-avatar bot-avatar-image ${className}`} src={asset || meta?.image || undefined} alt=""/>
  return <span className={`avatar-fallback bot-avatar bot-avatar-svg ${className}`} data-mood={mood ?? 'idle'} style={rhythm} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }}/>
}
