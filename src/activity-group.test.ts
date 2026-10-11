import { describe, expect, it } from 'vitest'

import { activitySummary, buildTranscript, reasoningSnippet, thinkingStepFromMessage, toolStepFromMessage, type ActivityStep } from './activity-group'
import type { LiveMessage } from './hermes'

const toolMessage = (id: number, name: string, status: 'running' | 'done' | 'failed' = 'done'): LiveMessage =>
  ({ id, role: 'tool', content: `${name} output`, tool_name: name, tool_status: status, duration_s: 1.5 })

const userMessage = (id: number): LiveMessage => ({ id, role: 'user', content: 'hello' })

const assistant = (id: number, content: string, reasoning?: string): LiveMessage =>
  ({ id, role: 'assistant', content, reasoning: reasoning ?? null })

const step = (id: string, name: string, status: ActivityStep['status'] = 'done'): ActivityStep =>
  ({ id, kind: 'tool', name, status })

describe('buildTranscript', () => {
  it('collapses a run of consecutive tool calls into one entry', () => {
    const entries = buildTranscript([userMessage(1), toolMessage(2, 'terminal'), toolMessage(3, 'process_manage'), toolMessage(4, 'read_file')], [])
    expect(entries).toHaveLength(2)
    const run = entries[1]
    if (run.kind !== 'activity') throw new Error('expected an activity run')
    expect(run.steps.map(item => item.name)).toEqual(['terminal', 'process_manage', 'read_file'])
  })

  it('folds reasoning into the same run as the tool calls around it', () => {
    // The reported defect: tool, thinking blurb, tool, thinking blurb produced a
    // stack of cards. Both kinds now share one updating entry.
    const entries = buildTranscript([
      toolMessage(2, 'terminal'),
      assistant(3, '', 'First I check the tree.\nMore detail.'),
      toolMessage(4, 'process_manage'),
      assistant(5, 'All done.'),
    ], [])

    expect(entries).toHaveLength(2)
    const run = entries[0]
    if (run.kind !== 'activity') throw new Error('expected an activity run')
    expect(run.steps.map(item => item.kind)).toEqual(['tool', 'thinking', 'tool'])
    expect(run.steps[1].summary).toBe('First I check the tree.')
    expect(entries[1].kind).toBe('message')
  })

  it('never leaves an empty row for a reasoning-only message', () => {
    const entries = buildTranscript([assistant(2, '   ', 'Thinking only.')], [])
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe('activity')
  })

  it('keeps assistant answer text as its own visible message', () => {
    const entries = buildTranscript([assistant(2, 'Here is the answer.', 'Some reasoning.')], [])
    expect(entries.map(entry => entry.kind)).toEqual(['activity', 'message'])
    expect(entries[1].kind === 'message' && entries[1].message.content).toBe('Here is the answer.')
  })

  it('keeps the run key stable as later steps join it, so one bubble updates in place', () => {
    const first = buildTranscript([toolMessage(2, 'terminal')], [])
    const later = buildTranscript([toolMessage(2, 'terminal'), assistant(3, '', 'thinking'), toolMessage(4, 'grep')], [])
    expect(later[0].key).toBe(first[0].key)
    expect(later).toHaveLength(1)
  })

  it('splits runs that an answer separates', () => {
    const entries = buildTranscript([toolMessage(2, 'terminal'), assistant(3, 'done'), toolMessage(4, 'grep')], [])
    expect(entries.map(entry => entry.kind)).toEqual(['activity', 'message', 'activity'])
  })

  it('appends live steps as their own entry rather than merging into a durable run', () => {
    const entries = buildTranscript([toolMessage(2, 'terminal')], [step('live-1', 'terminal')])
    expect(entries).toHaveLength(2)
    expect(entries[1].key).toBe('activity:live')
  })

  it('is empty for an empty conversation', () => {
    expect(buildTranscript([], [])).toEqual([])
  })
})

describe('reasoningSnippet', () => {
  it('takes the first meaningful line and strips Markdown noise', () => {
    expect(reasoningSnippet('\n\n## **Plan** of attack\nmore')).toBe('Plan of attack')
  })

  it('is empty when there is nothing to show', () => {
    expect(reasoningSnippet('\n   \n')).toBe('')
  })
})

describe('step builders', () => {
  it('maps a durable tool row onto a tool step', () => {
    expect(toolStepFromMessage(toolMessage(7, 'terminal'))).toMatchObject({ id: '7', kind: 'tool', name: 'terminal', status: 'done' })
  })

  it('maps a reasoning message onto a thinking step', () => {
    expect(thinkingStepFromMessage(assistant(8, '', 'Weighing options.'))).toEqual({
      id: 'thinking:8', kind: 'thinking', name: 'Thinking', status: 'done', summary: 'Weighing options.',
    })
  })
})

describe('activitySummary', () => {
  it('reports the completion count while a run is still going', () => {
    expect(activitySummary([step('a', 'terminal'), step('b', 'grep'), step('c', 'process_manage', 'running')]))
      .toMatchObject({ headline: 'process_manage', detail: '2 of 3 done', status: 'running' })
  })

  it('reports the step count once a run settles', () => {
    expect(activitySummary([step('a', 'terminal'), step('b', 'grep')])).toMatchObject({ headline: 'grep', detail: '2 steps' })
  })

  it('reports failures', () => {
    expect(activitySummary([step('a', 'terminal'), step('b', 'grep', 'failed')])).toMatchObject({ headline: 'grep', detail: '1 of 2 failed' })
  })

  it('surfaces the reasoning text when thinking is the newest step', () => {
    const summary = activitySummary([step('a', 'terminal'), { id: 't', kind: 'thinking', name: 'Thinking', status: 'done', summary: 'Weighing the options' }])
    expect(summary).toMatchObject({ headline: 'Thinking', detail: 'Weighing the options', kind: 'thinking' })
  })

  it('still prefers an in-flight tool over a newer settled thinking step', () => {
    const summary = activitySummary([{ id: 'c', kind: 'tool', name: 'terminal', status: 'running' }, { id: 't', kind: 'thinking', name: 'Thinking', status: 'done', summary: 'note' }])
    expect(summary).toMatchObject({ headline: 'terminal', status: 'running' })
  })

  it('falls back to a status word when a single call has no summary', () => {
    expect(activitySummary([step('a', 'terminal')]).detail).toBe('completed')
  })
})
