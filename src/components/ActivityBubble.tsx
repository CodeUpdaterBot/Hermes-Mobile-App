import { useState } from 'react'
import { ChevronDown, Lightbulb, Wrench } from 'lucide-react'

import { activitySummary, type ActivityStep } from '../activity-group'

const GLYPH: Record<string, string> = { running: '⋯', failed: '!', done: '✓' }

/**
 * One bubble for a whole run of work — tool calls and thinking alike.
 *
 * Sequential tool calls and reasoning steps update this row in place instead of
 * appending a full-width card each, and the whole sequence is one tap away.
 */
export function ActivityBubble({ steps }: { steps: ActivityStep[] }) {
  const [expanded, setExpanded] = useState(false)
  const expandable = steps.length > 1
  const { headline, detail, status, kind } = activitySummary(steps)
  const thinking = kind === 'thinking'

  return (
    <div className={`activity-bubble ${status} ${thinking ? 'thinking' : ''}`}>
      <button
        type="button"
        className="activity-head"
        onClick={() => expandable && setExpanded(value => !value)}
        aria-expanded={expandable ? expanded : undefined}
        aria-label={expandable ? `${headline}, ${detail}. ${expanded ? 'Hide' : 'Show'} ${steps.length} steps` : `${headline}, ${detail}`}
        disabled={!expandable}
      >
        <span className="activity-glyph">{status === 'running' ? <i>{GLYPH.running}</i> : thinking ? <Lightbulb size={14}/> : <Wrench size={14}/>}</span>
        <span className="activity-labels"><b>{headline}</b><small>{detail}</small></span>
        {expandable && <ChevronDown size={15} className={expanded ? 'turn' : ''}/>}
      </button>

      {expandable && expanded && <ol className="activity-steps">{steps.map(step => <li key={step.id} className={`${step.status} ${step.kind}`}><span className="activity-step-glyph">{step.kind === 'thinking' ? <Lightbulb size={12}/> : GLYPH[step.status]}</span><b>{step.name}</b><small>{step.summary || step.status}</small>{step.duration_s != null && <time>{step.duration_s.toFixed(1)}s</time>}</li>)}</ol>}
    </div>
  )
}
