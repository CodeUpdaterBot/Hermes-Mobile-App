import type { CronJob } from './hermes'

/**
 * Shared scheduled-task semantics.
 *
 * Extracted so the Tasks screen and the wide-layout Routines column cannot drift:
 * a job that reads "paused" in one place must never read "scheduled" in the other.
 */

export type CronState = 'paused' | 'running' | 'error' | 'scheduled'

/**
 * `enabled === false` is treated as paused even when `state` still says
 * `scheduled`, because a pause request can be acknowledged before the host's list
 * read reflects it.
 */
export function cronStateOf(job: CronJob): CronState {
  if (job.state === 'paused' || job.enabled === false) return 'paused'
  if (job.state === 'running') return 'running'
  if (job.last_error) return 'error'
  return 'scheduled'
}

/** The host prefixes bot-scoped job names; the user should not see that prefix. */
export function cronJobTitle(job: CronJob): string {
  return (job.name || 'Untitled task').replace(/^\[bot:[^\]]+\]\s*/i, '')
}

/** Jobs a given Bot is responsible for. */
export function jobsForProfile(jobs: CronJob[], profile: string): CronJob[] {
  return jobs.filter(job => !job.profile || job.profile === profile)
}
