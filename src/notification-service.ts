import { invoke } from '@tauri-apps/api/core'

import { splitDataUrl } from './avatar-raster'
import {
  planNotificationUpdates,
  readNotificationPreferences,
  resolveProgress,
  type BotActivity,
  type NotificationPlan,
  type NotificationPreferences,
  type PostedNotification,
} from './bot-notifications'

/**
 * The bridge between the app's view of a running turn and the native
 * notification plugin.
 *
 * Every call is written so that a missing plugin, a denied permission or a
 * platform without notifications degrades to a silent no-op: a notification is
 * never allowed to break the conversation it is reporting on.
 */

const command = (name: string) => `plugin:hermes-notifications|${name}`

/** Accent for the progress bar; the app's success green. */
export const DEFAULT_BOT_NOTIFICATION_COLOR = '#49C088'

export type NotificationPlatform = 'android' | 'ios' | 'desktop'

/**
 * Notifications are a phone surface. This only decides whether the Settings
 * control should present itself as available — the plugin remains the authority
 * on whether it can actually post.
 */
export function notificationPlatform(): NotificationPlatform {
  if (typeof navigator === 'undefined') return 'desktop'
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return 'android'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  return 'desktop'
}

export function notificationsAvailable(): boolean {
  const platform = notificationPlatform()
  return platform === 'android' || platform === 'ios'
}

export type PermissionState = { granted: boolean; enabledInSystem: boolean }

async function call<T>(name: string, payload?: unknown): Promise<T | null> {
  if (!notificationsAvailable()) return null
  try {
    return await invoke<T>(command(name), payload ? { payload } : undefined)
  } catch {
    return null
  }
}

export function permissionState(): Promise<PermissionState | null> {
  return call<PermissionState>('permissionState')
}

export function ensurePermission(): Promise<PermissionState | null> {
  return call<PermissionState>('ensurePermission')
}

export function clearAllNotifications(): Promise<unknown> {
  return call('clearAll')
}

export function preferences(): NotificationPreferences {
  return readNotificationPreferences()
}

/**
 * Keeps the OS notification set in step with the working Bots.
 *
 * Holds the posted set internally so the caller only has to hand over the
 * current activity; that set is what makes an unchanged notification a no-op.
 */
export function createNotificationSync() {
  let posted: PostedNotification[] = []

  return {
    /** @returns the plan that was applied, for tests and diagnostics. */
    async sync(activities: BotActivity[], preferences: NotificationPreferences, localHour: number): Promise<NotificationPlan> {
      const plan = planNotificationUpdates(activities, posted, preferences, localHour)

      for (const activity of plan.upsert) {
        const progress = resolveProgress(activity)
        const icon = activity.avatar ? splitDataUrl(activity.avatar) : null
        await call('upsert', {
          id: activity.key,
          bot: activity.bot,
          // Status line under the Bot name: what it is doing right now.
          detail: activity.detail,
          percent: progress.percent,
          running: true,
          ongoing: true,
          color: activity.color,
          iconBase64: icon?.base64 ?? null,
        })
      }

      for (const activity of plan.finish) {
        const icon = activity.avatar ? splitDataUrl(activity.avatar) : null
        await call('finish', {
          id: activity.key,
          bot: activity.bot,
          detail: activity.failed ? 'Stopped with an error' : 'Finished',
          color: activity.color,
          failed: activity.failed,
          iconBase64: icon?.base64 ?? null,
        })
      }

      for (const key of plan.clear) await call('clear', { id: key })

      // Rebuild the posted set from the plan rather than re-deriving it, so a
      // failed native call cannot leave the local view claiming success.
      const byKey = new Map(posted.map(item => [item.key, item]))
      for (const activity of plan.upsert) {
        byKey.set(activity.key, {
          key: activity.key,
          running: true,
          percent: resolveProgress(activity).percent,
          detail: activity.detail,
          avatar: activity.avatar ?? null,
        })
      }
      for (const activity of plan.finish) {
        byKey.set(activity.key, { key: activity.key, running: false, percent: 100, detail: activity.failed ? 'failed' : 'finished', avatar: activity.avatar ?? null })
      }
      for (const key of plan.clear) byKey.delete(key)
      posted = [...byKey.values()]

      return plan
    },

    /** Drop every notification, e.g. when the user switches them off wholesale. */
    async reset(): Promise<void> {
      posted = []
      await clearAllNotifications()
    },

    postedKeys(): string[] {
      return posted.map(item => item.key)
    },
  }
}

export type NotificationSync = ReturnType<typeof createNotificationSync>
