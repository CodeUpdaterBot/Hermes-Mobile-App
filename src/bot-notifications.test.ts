import { describe, expect, it } from 'vitest'

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_PREFERENCE_KEY,
  inQuietHours,
  isBotIncluded,
  planNotificationUpdates,
  readNotificationPreferences,
  resolveProgress,
  writeNotificationPreferences,
  type BotActivity,
  type NotificationPreferences,
  type PostedNotification,
} from './bot-notifications'

const prefs = (overrides: Partial<NotificationPreferences> = {}): NotificationPreferences => ({
  ...DEFAULT_NOTIFICATION_PREFERENCES, enabled: true, ...overrides,
})

const activity = (overrides: Partial<BotActivity> = {}): BotActivity => ({
  key: 'p1::s1', bot: 'Inbox Manager', profile: 'p1', detail: 'Running terminal',
  stage: 'tools', stepsDone: 0, stepsTotal: null, running: true, failed: false, color: '#49C088', ...overrides,
})

const posted = (overrides: Partial<PostedNotification> = {}): PostedNotification => ({
  key: 'p1::s1', running: true, percent: 22, detail: 'Running terminal', ...overrides,
})

const fakeStorage = () => {
  const values = new Map<string, string>()
  return { values, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) } }
}

describe('notification preferences', () => {
  it('defaults to off, so the app never posts notifications unasked', () => {
    expect(readNotificationPreferences(null).enabled).toBe(false)
  })

  it('round-trips through storage', () => {
    const storage = fakeStorage()
    writeNotificationPreferences(prefs({ includeProfiles: ['p1'] }), storage)
    expect(storage.values.has(NOTIFICATION_PREFERENCE_KEY)).toBe(true)
    expect(readNotificationPreferences(storage)).toMatchObject({ enabled: true, includeProfiles: ['p1'] })
  })

  it('survives a corrupt record rather than breaking startup', () => {
    expect(readNotificationPreferences({ getItem: () => '{ not json' })).toEqual(DEFAULT_NOTIFICATION_PREFERENCES)
  })

  it('rejects a corrupt quiet-hour value instead of inventing a different hour', () => {
    const storage = fakeStorage()
    storage.setItem(NOTIFICATION_PREFERENCE_KEY, JSON.stringify({ enabled: true, quietHours: { enabled: true, startHour: 99, endHour: -4 } }))
    expect(readNotificationPreferences(storage).quietHours).toMatchObject({ startHour: 22, endHour: 7 })
  })
})

describe('isBotIncluded', () => {
  it('is false while the master switch is off', () => {
    expect(isBotIncluded(activity(), prefs({ enabled: false }))).toBe(false)
  })

  it('includes every Bot when no explicit selection exists', () => {
    expect(isBotIncluded(activity(), prefs())).toBe(true)
  })

  it('honours an explicit Bot selection', () => {
    expect(isBotIncluded(activity({ profile: 'p2' }), prefs({ includeProfiles: ['p1'] }))).toBe(false)
  })
})

describe('inQuietHours', () => {
  it('is inert when disabled', () => {
    expect(inQuietHours(23, { enabled: false, startHour: 22, endHour: 7 })).toBe(false)
  })

  it('wraps past midnight', () => {
    const quiet = { enabled: true, startHour: 22, endHour: 7 }
    expect(inQuietHours(23, quiet)).toBe(true)
    expect(inQuietHours(2, quiet)).toBe(true)
    expect(inQuietHours(7, quiet)).toBe(false)
    expect(inQuietHours(12, quiet)).toBe(false)
  })
})

describe('resolveProgress', () => {
  it('is exact when the Bot published a todo total', () => {
    expect(resolveProgress(activity({ stepsDone: 3, stepsTotal: 4 }))).toEqual({ indeterminate: false, percent: 75 })
  })

  it('estimates from coarse phases when no total is known', () => {
    expect(resolveProgress(activity({ stage: 'thinking' })).percent).toBe(12)
    expect(resolveProgress(activity({ stage: 'writing' })).percent).toBe(88)
  })

  it('advances as tools complete, so the bar actually moves during a run', () => {
    const none = resolveProgress(activity({ stage: 'tools', stepsDone: 0 })).percent
    const some = resolveProgress(activity({ stage: 'tools', stepsDone: 3 })).percent
    expect(some).toBeGreaterThan(none)
  })

  it('never reports 100% while the Bot is still working', () => {
    // A bar that says "done" mid-run would be a lie; only a finished turn shows 100.
    expect(resolveProgress(activity({ stage: 'tools', stepsDone: 40 })).percent).toBeLessThan(100)
    expect(resolveProgress(activity({ stage: 'writing' })).percent).toBeLessThan(100)
    // Even a Bot reporting every todo done is capped while the turn is open.
    expect(resolveProgress(activity({ stepsDone: 9, stepsTotal: 9 })).percent).toBe(95)
    expect(resolveProgress(activity({ stepsDone: 9, stepsTotal: 9, running: false })).percent).toBe(100)
  })

  it('reports started rather than zero, so the bar is never empty mid-run', () => {
    expect(resolveProgress(activity({ stage: 'thinking' })).percent).toBeGreaterThan(0)
  })

  it('completes when the run has stopped', () => {
    expect(resolveProgress(activity({ running: false }))).toEqual({ indeterminate: false, percent: 100 })
  })
})

describe('planNotificationUpdates', () => {
  it('withdraws everything when notifications are switched off', () => {
    expect(planNotificationUpdates([activity()], [posted()], prefs({ enabled: false }), 12))
      .toEqual({ upsert: [], finish: [], clear: ['p1::s1'] })
  })

  it('posts a running Bot that has no notification yet', () => {
    expect(planNotificationUpdates([activity()], [], prefs(), 12).upsert).toHaveLength(1)
  })

  it('does not re-post an unchanged notification, which would flicker the lockscreen', () => {
    expect(planNotificationUpdates([activity()], [posted()], prefs(), 12)).toEqual({ upsert: [], finish: [], clear: [] })
  })

  it('updates when the status line changes', () => {
    expect(planNotificationUpdates([activity({ detail: 'Reading files' })], [posted()], prefs(), 12).upsert).toHaveLength(1)
  })

  it('updates when progress advances', () => {
    const progressed = activity({ stage: 'tools', stepsDone: 4 })
    expect(planNotificationUpdates([progressed], [posted()], prefs(), 12).upsert).toHaveLength(1)
  })

  it('converts a finished run into one completion report, then stops', () => {
    const done = activity({ running: false })
    const first = planNotificationUpdates([done], [posted()], prefs(), 12)
    expect(first.finish).toHaveLength(1)
    expect(first.finish[0].alert).toBe(true)
    expect(planNotificationUpdates([done], [posted({ running: false })], prefs(), 12)).toEqual({ upsert: [], finish: [], clear: [] })
  })

  it('keeps a completion silent during quiet hours but still reports it', () => {
    const plan = planNotificationUpdates([activity({ running: false })], [posted()], prefs({ quietHours: { enabled: true, startHour: 22, endHour: 7 } }), 23)
    expect(plan.finish).toHaveLength(1)
    expect(plan.finish[0].alert).toBe(false)
  })

  it('withdraws a Bot the user removed from the selection', () => {
    expect(planNotificationUpdates([activity({ profile: 'p2' })], [posted()], prefs({ includeProfiles: ['p1'] }), 12).clear).toEqual(['p1::s1'])
  })

  it('withdraws a Bot that is no longer active', () => {
    expect(planNotificationUpdates([], [posted()], prefs(), 12).clear).toEqual(['p1::s1'])
  })
})
