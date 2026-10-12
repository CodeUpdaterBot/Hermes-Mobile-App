import { useEffect, useRef, useState } from 'react'
import { CalendarClock, Plus } from 'lucide-react'

import { cronJobTitle, cronStateOf, jobsForProfile } from '../cron-state'
import { loadCronJobs, type CronJob } from '../hermes'

/**
 * The scheduled work a Bot is responsible for, under its computer in the wide
 * workspace. Paused jobs stay visible but greyed, matching the Tasks screen's
 * rule that pausing must never remove the only way to resume a job.
 */
export function BotRoutines({ profile, onNewRoutine }: { profile: string; onNewRoutine?: () => void }) {
  const [jobs, setJobs] = useState<CronJob[] | null>(null)
  const [error, setError] = useState('')
  const epochRef = useRef(0)

  useEffect(() => {
    const epoch = ++epochRef.current
    setJobs(null)
    setError('')
    loadCronJobs(profile)
      .then(list => { if (epoch === epochRef.current) setJobs(jobsForProfile(list, profile)) })
      .catch(reason => {
        if (epoch !== epochRef.current) return
        setJobs([])
        setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => { epochRef.current += 1 }
  }, [profile])

  return <section className="routines" aria-label="Scheduled routines">
    <header className="routines-head"><CalendarClock size={14}/><b>Routines</b></header>
    {jobs === null && <p className="routines-note">Loading routines…</p>}
    {jobs?.length ? <ul className="routines-list">{jobs.map(job => {
      const state = cronStateOf(job)
      const off = state === 'paused'
      return <li className={`routine${off ? ' off' : ''}`} key={job.job_id}>
        <span className={`routine-dot ${state}`} aria-hidden="true"/>
        <span className="routine-copy">
          <b>{cronJobTitle(job)}</b>
          <small>{job.schedule || 'No schedule'}</small>
        </span>
        <em className={`routine-state ${state}`}>{off ? 'Off' : state === 'running' ? 'Running' : state === 'error' ? 'Attention' : 'Active'}</em>
      </li>
    })}</ul> : jobs && !error ? <p className="routines-note">No routines assigned to this Bot.</p> : null}
    {error && <p className="routines-note warn">Routines unavailable</p>}
    {onNewRoutine && <button className="routines-new" onClick={onNewRoutine}><Plus size={14}/> New routine</button>}
  </section>
}
