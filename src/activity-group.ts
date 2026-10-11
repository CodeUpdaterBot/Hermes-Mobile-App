import type { LiveMessage } from './hermes'

export type ActivityStepStatus = 'running' | 'done' | 'failed'

/** Thinking is part of the working sequence, not a separate chat item. */
export type ActivityStepKind = 'tool' | 'thinking'

export type ActivityStep = {
  id: string
  kind: ActivityStepKind
  /** Tool name, or `Thinking` for a reasoning step. */
  name: string
  status: ActivityStepStatus
  duration_s?: number
  summary?: string
}

/** A transcript is rendered as ordered entries; the working sequence collapses. */
export type TranscriptEntry =
  | { kind: 'message'; key: string; message: LiveMessage }
  | { kind: 'activity'; key: string; steps: ActivityStep[] }

export function toolStepFromMessage(message: LiveMessage): ActivityStep {
  return {
    id: String(message.id),
    kind: 'tool',
    name: message.tool_name || 'tool',
    status: message.tool_status || 'done',
    duration_s: message.duration_s,
    summary: message.content,
  }
}

/** First non-empty line of the reasoning, stripped of Markdown noise. */
export function reasoningSnippet(reasoning: string): string {
  return reasoning
    .split('\n')
    .map(line => line.replace(/^#{1,6}\s*/, '').replace(/[*_`~]/g, '').trim())
    .find(line => line.length > 0) ?? ''
}

export function thinkingStepFromMessage(message: LiveMessage): ActivityStep {
  return {
    id: `thinking:${message.id}`,
    kind: 'thinking',
    name: 'Thinking',
    status: 'done',
    summary: reasoningSnippet(message.reasoning ?? ''),
  }
}

/**
 * Collapse the working sequence — tool calls AND reasoning — into one entry per
 * run.
 *
 * A turn that calls ten tools and thinks between each call used to render a long
 * alternation of cards (tool, thinking blurb, tool, thinking blurb), which buried
 * the answer and scrolled the conversation off screen. A run becomes one entry
 * that reports its latest step and can be expanded to inspect the sequence. The
 * entry key is derived from the first item of the run, so later steps update that
 * entry in place instead of appending another card.
 *
 * An assistant message keeps its own entry only when it carries answer text; a
 * reasoning-only message contributes a thinking step and nothing else, so it can
 * never leave an empty row behind.
 *
 * Live steps are kept as their own trailing entry rather than merged into a
 * durable run: a call can appear live and, moments later, in the reloaded
 * transcript, and merging would list that step twice inside one bubble.
 */
export function buildTranscript(messages: LiveMessage[], liveSteps: ActivityStep[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []

  const appendStep = (step: ActivityStep) => {
    const last = entries[entries.length - 1]
    if (last && last.kind === 'activity') last.steps.push(step)
    else entries.push({ kind: 'activity', key: `activity:${step.id}`, steps: [step] })
  }

  for (const message of messages) {
    if (message.role === 'tool') {
      appendStep(toolStepFromMessage(message))
      continue
    }
    if (message.role === 'assistant' && message.reasoning) appendStep(thinkingStepFromMessage(message))
    if (message.role === 'assistant' && !message.content.trim()) continue
    entries.push({ kind: 'message', key: `message:${message.id}`, message })
  }

  if (liveSteps.length) entries.push({ kind: 'activity', key: 'activity:live', steps: [...liveSteps] })
  return entries
}

const STATUS_WORD: Record<ActivityStepStatus, string> = {
  running: 'running…',
  done: 'completed',
  failed: 'failed',
}

/** Report whatever step is in flight, otherwise the newest one. */
function headlineStep(steps: ActivityStep[]): ActivityStep {
  const running = steps.filter(step => step.status === 'running')
  return running.length ? running[running.length - 1] : steps[steps.length - 1]
}

/**
 * What the collapsed bubble shows. The headline follows the step actually in
 * flight, so the single visible row keeps pace with the run. A reasoning step
 * reports its own text, which is the useful part of "Thinking".
 */
export function activitySummary(steps: ActivityStep[]): { headline: string; detail: string; status: ActivityStepStatus; total: number; kind: ActivityStepKind } {
  const total = steps.length
  const running = steps.filter(step => step.status === 'running')
  const failed = steps.filter(step => step.status === 'failed')
  const current = headlineStep(steps)
  const status: ActivityStepStatus = running.length ? 'running' : failed.length ? 'failed' : 'done'

  if (current.kind === 'thinking' && current.summary && status !== 'running') {
    return { headline: current.name, detail: current.summary, status, total, kind: current.kind }
  }

  let detail: string
  if (total === 1) detail = current.summary || STATUS_WORD[current.status]
  else if (status === 'running') detail = `${total - running.length} of ${total} done`
  else if (status === 'failed') detail = `${failed.length} of ${total} failed`
  else detail = `${total} steps`

  return { headline: current.name, detail, status, total, kind: current.kind }
}
