import { describe, expect, it } from 'vitest'

import { activitySummary, buildTranscript, toolStepFromMessage, type ToolStep } from './activity-group'
import type { LiveMessage } from './hermes'

const toolMessage = (id: number, name: string, status: 'running' | 'done' | 'failed' = 'done'): LiveMessage =>
  ({ id, role: 'tool', content: `${name} output`, tool_name: name, tool_status: status, duration_s: 1.5 })

const userMessage = (id: number): LiveMessage => ({ id, role: 'user', content: 'hello' })

const step = (id: string, name: string, status: ToolStep['status'] = 'done'): ToolStep => ({ id, name, status })

describe('buildTranscript', () => {
  it('collapses a run of consecutive tool calls into one entry', () => {
    const entries = buildTranscript([
      userMessage(1),
      toolMessage(2, 'terminal'),
      toolMessage(3, 'process_manage'),
      toolMessage(4, 'read_file'),
    ], [])

    expect(entries).toHaveLength(2)
    expect(entries[0].kind).toBe('message')
    const run = entries[1]
    expect(run.kind).toBe('tools')
    if (run.kind !== 'tools') throw new Error('expected a tool run')
    expect(run.steps.map(item => item.name)).toEqual(['terminal', 'process_manage', 'read_file'])
  })

  it('keeps the run key stable as later calls join it, so one bubble updates in place', () => {
    const first = buildTranscript([toolMessage(2, 'terminal')], [])
    const later = buildTranscript([toolMessage(2, 'terminal'), toolMessage(3, 'process_manage')], [])
    expect(later[0].key).toBe(first[0].key)
    expect(later).toHaveLength(1)
  })

  it('splits runs that are separated by a message', () => {
    const entries = buildTranscript([
      toolMessage(2, 'terminal'),
      { id: 3, role: 'assistant', content: 'done' },
      toolMessage(4, 'grep'),
    ], [])
    expect(entries.map(entry => entry.kind)).toEqual(['tools', 'message', 'tools'])
  })

  it('appends live steps as their own entry rather than merging into a durable run', () => {
    // The same call can appear live and then in the reloaded transcript, so
    // merging would list it twice inside a single bubble.
    const entries = buildTranscript([toolMessage(2, 'terminal')], [step('live-1', 'terminal')])
    expect(entries).toHaveLength(2)
    expect(entries[1].key).toBe('tools:live')
  })

  it('renders a lone tool call as a single-step entry', () => {
    const entries = buildTranscript([toolMessage(9, 'terminal')], [])
    expect(entries[0].kind).toBe('tools')
    if (entries[0].kind !== 'tools') throw new Error('expected a tool run')
    expect(entries[0].steps).toHaveLength(1)
  })

  it('is empty for an empty conversation', () => {
    expect(buildTranscript([], [])).toEqual([])
  })
})

describe('toolStepFromMessage', () => {
  it('maps a durable tool row onto a step', () => {
    expect(toolStepFromMessage(toolMessage(7, 'terminal'))).toEqual({
      id: '7', name: 'terminal', status: 'done', duration_s: 1.5, summary: 'terminal output',
    })
  })

  it('falls back for a row missing its tool metadata', () => {
    expect(toolStepFromMessage({ id: 8, role: 'tool', content: '' })).toEqual({
      id: '8', name: 'tool', status: 'done', duration_s: undefined, summary: '',
    })
  })
})

describe('activitySummary', () => {
  it('reports the completion count while a run is still going', () => {
    const summary = activitySummary([step('a', 'terminal'), step('b', 'grep'), step('c', 'process_manage', 'running')])
    expect(summary).toMatchObject({ headline: 'process_manage', detail: '2 of 3 done', status: 'running', total: 3 })
  })

  it('reports the step count once a run settles', () => {
    const summary = activitySummary([step('a', 'terminal'), step('b', 'grep')])
    expect(summary).toMatchObject({ headline: 'grep', detail: '2 steps', status: 'done' })
  })

  it('reports failures', () => {
    const summary = activitySummary([step('a', 'terminal'), step('b', 'grep', 'failed')])
    expect(summary).toMatchObject({ headline: 'grep', detail: '1 of 2 failed', status: 'failed' })
  })

  it('uses the step summary for a single call', () => {
    const summary = activitySummary([{ id: 'a', name: 'terminal', status: 'done', summary: 'Replaced 3 files' }])
    expect(summary).toMatchObject({ headline: 'terminal', detail: 'Replaced 3 files', status: 'done', total: 1 })
  })

  it('falls back to a status word when a single call has no summary', () => {
    expect(activitySummary([step('a', 'terminal')]).detail).toBe('completed')
    expect(activitySummary([step('a', 'terminal', 'running')]).detail).toBe('running…')
  })
})
