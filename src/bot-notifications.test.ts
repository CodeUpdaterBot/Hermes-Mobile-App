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
  key: 'p1::s1', bot: 'Inbox Manager', profile: 'p1', action: 'terminal', stepsDone: 0, stepsTotal: null,
  running: true, failed: false, color: '#49C088', ...overrides,
})

const posted = (overrides: Partial<PostedNotification> = {}): PostedNotification => ({
  key: 'p1::s1', running: true, indeterminate: true, percent: 0, action: 'terminal', ...overrides,
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

  it('clamps an out-of-range quiet-hour value', () => {
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
    expect(isBotIncluded(activity({ profile: 'p1' }), prefs({ includeProfiles: ['p1'] }))).toBe(true)
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

  it('handles a same-day window', () => {
    const quiet = { enabled: true, startHour: 9, endHour: 17 }
    expect(inQuietHours(10, quiet)).toBe(true)
    expect(inQuietHours(18, quiet)).toBe(false)
  })

  it('treats an empty window as no quiet hours', () => {
    expect(inQuietHours(12, { enabled: true, startHour: 8, endHour: 8 })).toBe(false)
  })
})

describe('resolveProgress', () => {
  it('is indeterminate when the total is unknown rather than inventing a percentage', () => {
    expect(resolveProgress(activity({ stepsTotal: null }))).toEqual({ indeterminate: true, percent: 0 })
  })

  it('is determinate once the Bot published a todo total', () => {
    expect(resolveProgress(activity({ stepsDone: 3, stepsTotal: 4 }))).toEqual({ indeterminate: false, percent: 75 })
  })

  it('clamps overshoot and never exceeds 100', () => {
    expect(resolveProgress(activity({ stepsDone: 9, stepsTotal: 4 })).percent).toBe(100)
  })

  it('completes when the run has stopped', () => {
    expect(resolveProgress(activity({ running: false }))).toEqual({ indeterminate: false, percent: 100 })
  })
})

describe('planNotificationUpdates', () => {
  it('withdraws everything when notifications are switched off', () => {
    const plan = planNotificationUpdates([activity()], [posted()], prefs({ enabled: false }), 12)
    expect(plan).toEqual({ upsert: [], finish: [], clear: ['p1::s1'] })
  })

  it('posts a running Bot that has no notification yet', () => {
    const plan = planNotificationUpdates([activity()], [], prefs(), 12)
    expect(plan.upsert).toHaveLength(1)
    expect(plan.finish).toEqual([])
  })

  it('does not re-post an unchanged notification, which would flicker the lockscreen', () => {
    const plan = planNotificationUpdates([activity()], [posted()], prefs(), 12)
    expect(plan).toEqual({ upsert: [], finish: [], clear: [] })
  })

  it('updates when the action or progress actually changes', () => {
    expect(planNotificationUpdates([activity({ action: 'read_file' })], [posted()], prefs(), 12).upsert).toHaveLength(1)
    const progressed = activity({ stepsDone: 2, stepsTotal: 4 })
    expect(planNotificationUpdates([progressed], [{ ...posted(), indeterminate: true, percent: 0 }], prefs(), 12).upsert).toHaveLength(1)
  })

  it('converts a finished run into one completion report, then stops', () => {
    const done = activity({ running: false })
    const first = planNotificationUpdates([done], [posted()], prefs(), 12)
    expect(first.finish).toHaveLength(1)
    expect(first.finish[0].alert).toBe(true)
    const settled = [posted({ running: false })]
    expect(planNotificationUpdates([done], settled, prefs(), 12)).toEqual({ upsert: [], finish: [], clear: [] })
  })

  it('keeps a completion silent during quiet hours but still reports it', () => {
    const plan = planNotificationUpdates([activity({ running: false })], [posted()], prefs({ quietHours: { enabled: true, startHour: 22, endHour: 7 } }), 23)
    expect(plan.finish).toHaveLength(1)
    expect(plan.finish[0].alert).toBe(false)
  })

  it('withdraws a Bot the user removed from the selection', () => {
    const plan = planNotificationUpdates([activity({ profile: 'p2' })], [posted()], prefs({ includeProfiles: ['p1'] }), 12)
    expect(plan.clear).toEqual(['p1::s1'])
  })

  it('withdraws a Bot that is no longer active', () => {
    const plan = planNotificationUpdates([], [posted()], prefs(), 12)
    expect(plan.clear).toEqual(['p1::s1'])
  })
})
