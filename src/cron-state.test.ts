import { describe, expect, it } from 'vitest'

import { cronJobTitle, cronStateOf, jobsForProfile } from './cron-state'
import type { CronJob } from './hermes'

const job = (overrides: Partial<CronJob> = {}): CronJob => ({ job_id: 'j1', name: 'Morning sweep', ...overrides })

describe('cronStateOf', () => {
  it('reads a plainly scheduled job as scheduled', () => {
    expect(cronStateOf(job({ state: 'scheduled' }))).toBe('scheduled')
  })

  it('treats enabled=false as paused even while state still says scheduled', () => {
    // A pause can be acknowledged before the host's list read reflects it.
    expect(cronStateOf(job({ state: 'scheduled', enabled: false }))).toBe('paused')
  })

  it('reads an explicit paused state', () => {
    expect(cronStateOf(job({ state: 'paused' }))).toBe('paused')
  })

  it('surfaces a running job and a job with a last error', () => {
    expect(cronStateOf(job({ state: 'running' }))).toBe('running')
    expect(cronStateOf(job({ last_error: 'boom' }))).toBe('error')
  })

  it('prefers paused over a stale error', () => {
    expect(cronStateOf(job({ state: 'paused', last_error: 'boom' }))).toBe('paused')
  })
})

describe('cronJobTitle', () => {
  it('strips the bot-scoping prefix the host adds', () => {
    expect(cronJobTitle(job({ name: '[bot:inbox-manager] Morning sweep' }))).toBe('Morning sweep')
  })

  it('keeps an ordinary name and falls back when absent', () => {
    expect(cronJobTitle(job({ name: 'Reply Zero' }))).toBe('Reply Zero')
    expect(cronJobTitle(job({ name: undefined }))).toBe('Untitled task')
  })
})

describe('jobsForProfile', () => {
  it('keeps jobs for the Bot and unscoped jobs, and drops other Bots', () => {
    const jobs = [
      job({ job_id: 'a', profile: 'inbox-manager' }),
      job({ job_id: 'b', profile: 'sales-outbound' }),
      job({ job_id: 'c', profile: undefined }),
    ]
    expect(jobsForProfile(jobs, 'inbox-manager').map(item => item.job_id)).toEqual(['a', 'c'])
  })
})
