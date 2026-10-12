import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, BellOff, BellRing, LoaderCircle } from 'lucide-react'

import { readNotificationPreferences, writeNotificationPreferences, type NotificationPreferences } from '../bot-notifications'
import { ensurePermissionWithDeadline, notificationPlatform, notificationsAvailable, permissionState, type PermissionState } from '../notification-service'
import { requestNotificationResync } from '../notification-bus'
import { useEdgeSwipeBack } from '../edge-swipe'
import type { LiveProfile } from '../hermes'

const titleize = (value: string) => value.split(/[-_]+/).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join(' ')
const label = (profile: LiveProfile) => profile.display_name || titleize(profile.name)
const HOURS = Array.from({ length: 24 }, (_, hour) => hour)
const formatHour = (hour: number) => `${String(hour).padStart(2, '0')}:00`

/**
 * Notification preferences.
 *
 * Every control writes through immediately: there is no save button, so the pane
 * cannot leave the stored preference and the visible switch disagreeing.
 */
export function NotificationsSettings({ back, profiles }: { back: () => void; profiles: LiveProfile[] }) {
  const shellRef = useRef<HTMLElement>(null)
  useEdgeSwipeBack(shellRef, back)

  const [preferences, setPreferences] = useState<NotificationPreferences>(() => readNotificationPreferences())
  const [permission, setPermission] = useState<PermissionState | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [hint, setHint] = useState('')
  const available = notificationsAvailable()
  const platform = notificationPlatform()

  useEffect(() => { void permissionState().then(setPermission) }, [])

  const update = (next: Partial<NotificationPreferences>) => {
    const merged = { ...preferences, ...next }
    setPreferences(merged)
    writeNotificationPreferences(merged)
  }

  const requestPermission = async () => {
    setRequesting(true)
    setHint('')
    try {
      const result = await ensurePermissionWithDeadline()
      if (result) {
        setPermission(result)
        // A grant is invisible to the shell's sync effect, so ask for a re-post: work already
        // in flight should announce itself now, not at its next state change.
        if (result.granted) requestNotificationResync()
        return
      }
      // No answer inside the deadline: the dialog may have been answered after it, or the
      // native callback never arrived. Ask Android directly so the screen shows the truth
      // rather than staying stuck on a request that is no longer being awaited.
      const settled = await permissionState()
      setPermission(settled)
      if (settled?.granted) { requestNotificationResync(); return }
      setHint('Android did not report an answer. If no prompt appeared, allow notifications for Hermes Mobile in system settings.')
    } finally {
      setRequesting(false)
    }
  }

  /**
   * Turning notifications on is the moment the user means it, so Android is asked right away
   * rather than leaving them to find the button above.
   */
  const toggleEnabled = () => {
    const next = !preferences.enabled
    update({ enabled: next })
    if (next && available && !permissionGranted) void requestPermission()
  }

  // An empty selection means "every Bot"; toggling one off materialises the full
  // list minus that Bot, and turning the last one back on collapses it again.
  const includedProfiles = preferences.includeProfiles.length ? preferences.includeProfiles : profiles.map(profile => profile.name)
  const toggleProfile = (name: string) => {
    const isOn = includedProfiles.includes(name)
    const next = isOn ? includedProfiles.filter(item => item !== name) : [...includedProfiles, name]
    update({ includeProfiles: next.length === profiles.length ? [] : next })
  }

  const permissionGranted = permission?.granted === true

  return <main ref={shellRef} className="app panel notifications-screen">
    <header className="panel-head"><button className="back-button" onClick={back} aria-label="Back"><ArrowLeft size={19}/></button><div><h2>Notifications</h2><p>Follow your Bots while you are elsewhere</p></div></header>

    <section className="notification-hero">
      {permissionGranted ? <BellRing size={17}/> : <BellOff size={17}/>}
      <div>
        <b>{permissionGranted ? 'Notifications are allowed' : available ? 'Notifications are off' : 'Not available on this device'}</b>
        <small>{available ? 'A Bot that is working shows up on your lock screen with its progress.' : 'OS notifications are a phone feature of Hermes Mobile.'}</small>
      </div>
    </section>

    {available && !permissionGranted && <button className="primary wide notification-allow" disabled={requesting} onClick={() => void requestPermission()}>{requesting ? <><LoaderCircle className="connection-sync-spinner" size={17}/> Asking Android…</> : 'Allow notifications'}</button>}
    {hint && <p className="notification-hint" role="status">{hint}</p>}
    {available && permissionGranted && permission?.enabledInSystem === false && <p className="notification-hint" role="status">Android is blocking Hermes Mobile notifications. Turn them back on in system settings.</p>}

    {!available && <p className="notification-hint" role="status">This {platform === 'desktop' ? 'desktop build' : 'platform'} cannot post OS notifications. The settings below still apply on your phone.</p>}

    <section className="menu-list">
      <button className="settings-toggle-row" onClick={toggleEnabled} aria-pressed={preferences.enabled}>
        Bot notifications <span className={`capability-toggle ${preferences.enabled ? 'on' : ''}`}><i/>{preferences.enabled ? 'ON' : 'OFF'}</span>
      </button>
    </section>

    {preferences.enabled && <>
      <section className="menu-list">
        <button className="settings-toggle-row" onClick={() => update({ alertOnFinish: !preferences.alertOnFinish })} aria-pressed={preferences.alertOnFinish}>
          Alert when a Bot finishes <span className={`capability-toggle ${preferences.alertOnFinish ? 'on' : ''}`}><i/>{preferences.alertOnFinish ? 'ON' : 'OFF'}</span>
        </button>
        <button className="settings-toggle-row" onClick={() => update({ quietHours: { ...preferences.quietHours, enabled: !preferences.quietHours.enabled } })} aria-pressed={preferences.quietHours.enabled}>
          Quiet hours <span className={`capability-toggle ${preferences.quietHours.enabled ? 'on' : ''}`}><i/>{preferences.quietHours.enabled ? 'ON' : 'OFF'}</span>
        </button>
      </section>

      {preferences.quietHours.enabled && <section className="notification-quiet" aria-label="Quiet hours window">
        <label>From <select value={preferences.quietHours.startHour} onChange={event => update({ quietHours: { ...preferences.quietHours, startHour: Number(event.target.value) } })}>{HOURS.map(hour => <option value={hour} key={hour}>{formatHour(hour)}</option>)}</select></label>
        <label>Until <select value={preferences.quietHours.endHour} onChange={event => update({ quietHours: { ...preferences.quietHours, endHour: Number(event.target.value) } })}>{HOURS.map(hour => <option value={hour} key={hour}>{formatHour(hour)}</option>)}</select></label>
      </section>}

      <p className="notification-section-label">BOTS TO INCLUDE</p>
      <section className="menu-list">
        {profiles.length ? profiles.map(profile => {
          const isOn = includedProfiles.includes(profile.name)
          return <button className="settings-toggle-row" key={profile.name} onClick={() => toggleProfile(profile.name)} aria-pressed={isOn}>
            {label(profile)} <span className={`capability-toggle ${isOn ? 'on' : ''}`}><i/>{isOn ? 'ON' : 'OFF'}</span>
          </button>
        }) : <p className="notification-hint">Connect to Hermes to choose Bots.</p>}
      </section>

      <p className="notification-note">Progress and status update while Hermes Mobile is open. If you leave the app mid-run, the notification you already have stays on your lock screen.</p>
    </>}
  </main>
}
