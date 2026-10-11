/**
 * OS notifications for Bots that are working.
 *
 * Hermes only tells us about activity two ways: globally (`sessions.changed`
 * says "state.db moved, refetch") and per-session (`tool.start`, `tool.complete`,
 * `message.delta`, `turn.end`) for a session this client has resumed. There is no
 * host-side per-Bot progress feed — the gateway's own `notification.show` event is
 * an in-app toast, not an OS notification. So the phone composes notifications
 * from the turn state it can actually observe, and this module keeps that
 * composition pure and testable.
 */

export type BotActivity = {
  /** Stable per Bot+session, so an update replaces the same notification. */
  key: string
  bot: string
  profile: string
  /** One line describing what the Bot is doing right now. */
  action: string
  stepsDone: number
  /** Only known when the Bot published a todo list; otherwise progress is unknown. */
  stepsTotal: number | null
  running: boolean
  failed: boolean
  color: string
}

export type NotificationPreferences = {
  enabled: boolean
  /** Profile names the user wants notifications for. Empty means "every Bot". */
  includeProfiles: string[]
  /** Alert when a run finishes instead of clearing silently. */
  alertOnFinish: boolean
  /** Suppress alerts (never progress updates) between these local hours. */
  quietHours: { enabled: boolean; startHour: number; endHour: number }
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: false,
  includeProfiles: [],
  alertOnFinish: true,
  quietHours: { enabled: false, startHour: 22, endHour: 7 },
}

export const NOTIFICATION_PREFERENCE_KEY = 'hermes-mobile-notifications'

type StorageLike = { getItem(key: string): string | null }
type WritableStorageLike = StorageLike & { setItem(key: string, value: string): void }

function defaultStorage(): WritableStorageLike | null {
  return typeof localStorage === 'undefined' ? null : localStorage
}

/** Tolerant read: a corrupt or partial record must never break startup. */
export function readNotificationPreferences(storage?: StorageLike | null): NotificationPreferences {
  const target = storage ?? defaultStorage()
  if (!target) return { ...DEFAULT_NOTIFICATION_PREFERENCES }
  try {
    const raw = target.getItem(NOTIFICATION_PREFERENCE_KEY)
    if (!raw) return { ...DEFAULT_NOTIFICATION_PREFERENCES }
    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>
    const quiet = parsed.quietHours ?? DEFAULT_NOTIFICATION_PREFERENCES.quietHours
    return {
      enabled: parsed.enabled === true,
      includeProfiles: Array.isArray(parsed.includeProfiles) ? parsed.includeProfiles.filter(item => typeof item === 'string') : [],
      alertOnFinish: parsed.alertOnFinish !== false,
      quietHours: {
        enabled: quiet.enabled === true,
        startHour: normalizeHour(quiet.startHour, DEFAULT_NOTIFICATION_PREFERENCES.quietHours.startHour),
        endHour: normalizeHour(quiet.endHour, DEFAULT_NOTIFICATION_PREFERENCES.quietHours.endHour),
      },
    }
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES }
  }
}

export function writeNotificationPreferences(preferences: NotificationPreferences, storage?: WritableStorageLike | null): void {
  const target = storage ?? defaultStorage()
  if (!target) return
  try {
    target.setItem(NOTIFICATION_PREFERENCE_KEY, JSON.stringify(preferences))
  } catch {
    /* A storage-blocked WebView must not break the Settings control. */
  }
}

/**
 * Only a real 0-23 hour is accepted. A corrupt value falls back to the default
 * rather than being clamped into a different hour the user never chose.
 */
function normalizeHour(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23 ? value : fallback
}

/** Whether this Bot should produce a notification at all. */
export function isBotIncluded(activity: BotActivity, preferences: NotificationPreferences): boolean {
  if (!preferences.enabled) return false
  if (!preferences.includeProfiles.length) return true
  return preferences.includeProfiles.includes(activity.profile)
}

/**
 * Quiet hours wrap past midnight, so the comparison is an interval that may be
 * inverted (22 -> 7 means "22:00 through 07:00").
 */
export function inQuietHours(hour: number, quiet: NotificationPreferences['quietHours']): boolean {
  if (!quiet.enabled) return false
  if (quiet.startHour === quiet.endHour) return false
  return quiet.startHour < quiet.endHour
    ? hour >= quiet.startHour && hour < quiet.endHour
    : hour >= quiet.startHour || hour < quiet.endHour
}

/**
 * Progress is only reported when the Bot published a todo total. Inventing a
 * percentage from elapsed time or step count would put a moving bar on the
 * lockscreen that never corresponds to real work.
 */
export function resolveProgress(activity: BotActivity): { indeterminate: boolean; percent: number } {
  if (!activity.running) return { indeterminate: false, percent: 100 }
  if (activity.stepsTotal == null || activity.stepsTotal <= 0) return { indeterminate: true, percent: 0 }
  const percent = Math.round((Math.min(activity.stepsDone, activity.stepsTotal) / activity.stepsTotal) * 100)
  return { indeterminate: false, percent: Math.min(100, Math.max(0, percent)) }
}

export type PostedNotification = {
  key: string
  running: boolean
  indeterminate: boolean
  percent: number
  action: string
}

export type NotificationPlan = {
  upsert: BotActivity[]
  /** Notifications to convert into a finished, clearable entry. */
  finish: Array<BotActivity & { alert: boolean }>
  /** Notifications to withdraw entirely. */
  clear: string[]
}

/**
 * Diff desired notifications against what is already posted.
 *
 * Only a real change produces an update: re-posting an unchanged notification on
 * every streamed token would make the lockscreen flicker. A Bot that stops being
 * included, or that is no longer active, is withdrawn rather than left stale.
 */
export function planNotificationUpdates(
  activities: BotActivity[],
  posted: PostedNotification[],
  preferences: NotificationPreferences,
  localHour: number,
): NotificationPlan {
  const plan: NotificationPlan = { upsert: [], finish: [], clear: [] }
  const quiet = inQuietHours(localHour, preferences.quietHours)

  if (!preferences.enabled) {
    for (const item of posted) plan.clear.push(item.key)
    return plan
  }

  const wanted = new Map<string, BotActivity>()
  for (const activity of activities) {
    if (isBotIncluded(activity, preferences)) wanted.set(activity.key, activity)
  }

  for (const activity of wanted.values()) {
    const existing = posted.find(item => item.key === activity.key)
    if (activity.running) {
      const progress = resolveProgress(activity)
      const unchanged = existing
        && existing.running
        && existing.action === activity.action
        && existing.indeterminate === progress.indeterminate
        && existing.percent === progress.percent
      if (!unchanged) plan.upsert.push(activity)
      continue
    }
    // The run has stopped. Report completion once, then leave it clearable.
    if (!existing || existing.running) plan.finish.push({ ...activity, alert: preferences.alertOnFinish && !quiet })
  }

  for (const item of posted) {
    if (!wanted.has(item.key)) plan.clear.push(item.key)
  }
  return plan
}
