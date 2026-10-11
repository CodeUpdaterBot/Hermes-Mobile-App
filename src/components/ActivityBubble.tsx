import { useState } from 'react'
import { ChevronDown, Wrench } from 'lucide-react'

import { activitySummary, type ToolStep } from '../activity-group'

const GLYPH: Record<string, string> = { running: '⋯', failed: '!', done: '✓' }

/**
 * One bubble for a whole run of tool calls.
 *
 * Sequential calls update this row in place — the headline follows the call
 * that is in flight and the detail reports progress — instead of appending a
 * full-width card per call and pushing the conversation off screen.
 */
export function ActivityBubble({ steps }: { steps: ToolStep[] }) {
  const [expanded, setExpanded] = useState(false)
  const expandable = steps.length > 1
  const { headline, detail, status } = activitySummary(steps)

  return (
    <div className={`activity-bubble ${status}`}>
      <button
        type="button"
        className="activity-head"
        onClick={() => expandable && setExpanded(value => !value)}
        aria-expanded={expandable ? expanded : undefined}
        aria-label={expandable ? `${headline}, ${detail}. ${expanded ? 'Hide' : 'Show'} ${steps.length} steps` : `${headline}, ${detail}`}
        disabled={!expandable}
      >
        <span className="activity-glyph">{status === 'done' ? <Wrench size={14}/> : <i>{GLYPH[status]}</i>}</span>
        <span className="activity-labels"><b>{headline}</b><small>{detail}</small></span>
        {expandable && <ChevronDown size={15} className={expanded ? 'turn' : ''}/>}
      </button>

      {expandable && expanded && <ol className="activity-steps">{steps.map(step => <li key={step.id} className={step.status}><span className="activity-step-glyph">{GLYPH[step.status]}</span><b>{step.name}</b><small>{step.summary || step.status}</small>{step.duration_s != null && <time>{step.duration_s.toFixed(1)}s</time>}</li>)}</ol>}
    </div>
  )
}
