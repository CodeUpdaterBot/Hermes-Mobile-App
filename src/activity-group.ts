import type { LiveMessage } from './hermes'

export type ToolStepStatus = 'running' | 'done' | 'failed'

export type ToolStep = {
  id: string
  name: string
  status: ToolStepStatus
  duration_s?: number
  summary?: string
}

/** A transcript is rendered as ordered entries; tool runs collapse into one. */
export type TranscriptEntry =
  | { kind: 'message'; key: string; message: LiveMessage }
  | { kind: 'tools'; key: string; steps: ToolStep[] }

export function toolStepFromMessage(message: LiveMessage): ToolStep {
  return {
    id: String(message.id),
    name: message.tool_name || 'tool',
    status: message.tool_status || 'done',
    duration_s: message.duration_s,
    summary: message.content,
  }
}

/**
 * Collapse each run of consecutive tool calls into a single transcript entry.
 *
 * A turn that calls ten tools produces ten durable `role: 'tool'` rows. Rendered
 * one bubble each they bury the actual answer and scroll the conversation off
 * screen, so a run becomes one entry that reports its latest call and can be
 * expanded to inspect the sequence. Entry keys are derived from the first step
 * of the run, which keeps the bubble identity stable as more calls arrive so
 * React updates it in place instead of appending a new bubble per call.
 *
 * Live steps are kept as their own trailing entry rather than merged into a
 * durable run: a call can appear both live and, moments later, in the reloaded
 * transcript, and merging would list that step twice inside one bubble.
 */
export function buildTranscript(messages: LiveMessage[], liveSteps: ToolStep[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []
  for (const message of messages) {
    if (message.role !== 'tool') {
      entries.push({ kind: 'message', key: `message:${message.id}`, message })
      continue
    }
    const step = toolStepFromMessage(message)
    const last = entries[entries.length - 1]
    if (last && last.kind === 'tools') last.steps.push(step)
    else entries.push({ kind: 'tools', key: `tools:${step.id}`, steps: [step] })
  }
  if (liveSteps.length) entries.push({ kind: 'tools', key: 'tools:live', steps: [...liveSteps] })
  return entries
}

const STATUS_WORD: Record<ToolStepStatus, string> = {
  running: 'running…',
  done: 'completed',
  failed: 'failed',
}

/**
 * What the collapsed bubble shows. The headline follows the call that is
 * actually in flight, so the single visible row keeps pace with the run.
 */
export function activitySummary(steps: ToolStep[]): { headline: string; detail: string; status: ToolStepStatus; total: number } {
  const total = steps.length
  const running = steps.filter(step => step.status === 'running')
  const failed = steps.filter(step => step.status === 'failed')
  const latest = steps[total - 1]
  const status: ToolStepStatus = running.length ? 'running' : failed.length ? 'failed' : 'done'
  const headline = (running.length ? running[running.length - 1] : latest).name

  let detail: string
  if (total === 1) detail = steps[0].summary || STATUS_WORD[steps[0].status]
  else if (status === 'running') detail = `${total - running.length} of ${total} done`
  else if (status === 'failed') detail = `${failed.length} of ${total} failed`
  else detail = `${total} steps`

  return { headline, detail, status, total }
}
