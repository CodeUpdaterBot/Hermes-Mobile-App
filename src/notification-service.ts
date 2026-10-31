import { addPluginListener, invoke } from '@tauri-apps/api/core'

import { withDeadline } from './deadline'
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

/** How long the app waits for Android's answer before it stops believing one is coming. */
export const PERMISSION_WAIT_MS = 30_000

/** `ensurePermission` under a deadline; null means "no answer", not "denied". */
export function ensurePermissionWithDeadline(ms = PERMISSION_WAIT_MS): Promise<PermissionState | null> {
  return withDeadline(ensurePermission(), ms)
}

export function clearAllNotifications(): Promise<unknown> {
  return call('clearAll')
}

export type ApprovalNotification = { requestId: string; bot: string; command: string; description: string }

/** Heads-up/lock-screen prompt with Allow once / Deny actions for an approval the host is waiting on. */
export function postApprovalNotification(approval: ApprovalNotification): Promise<unknown> {
  return call('approval', approval)
}

export function clearApprovalNotification(requestId: string): Promise<unknown> {
  // Approval notifications are keyed `approval:<request_id>` natively, so the ordinary clear
  // command removes them (and goes through the Rust layer that unwraps `payload`).
  return call('clear', { id: `approval:${requestId}` })
}

export type ApprovalAction = { requestId: string; choice: string }

/** Answers tapped on an approval notification; resolves to an unsubscribe function. */
export async function listenForApprovalActions(listener: (action: ApprovalAction) => void): Promise<() => void> {
  if (!notificationsAvailable()) return () => {}
  try {
    const handle = await addPluginListener<ApprovalAction>('hermes-notifications', 'approvalAction', listener)
    return () => { void handle.unregister() }
  } catch {
    return () => {}
  }
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
