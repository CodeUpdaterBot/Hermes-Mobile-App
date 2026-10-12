import { useState, type ReactNode } from 'react'
import { Check, Copy, Wrench } from 'lucide-react'
import Markdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'

import type { LiveMessage, LiveProfile } from '../hermes'
import { formatMessageTime, formatResponseStats } from '../message-stats'
import { BotAvatar } from './BotAvatar'

function CodeBlock({ className, children }: { className?: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const value = String(children).replace(/\n$/, '')
  const language = className?.match(/language-([\w-]+)/)?.[1] || 'code'
  const copy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }
  return <div className="code-block"><div className="code-head"><span>{language}</span><button onClick={() => void copy()} aria-label="Copy code">{copied ? <><Check size={13}/> Copied</> : <><Copy size={13}/> Copy</>}</button></div><pre><code className={className}>{children}</code></pre></div>
}

export function MarkdownContent({ children }: { children: string }) {
  const withMentionLinks = children.replace(/(^|\s)(@[a-zA-Z0-9][\w-]*)\b/g, '$1[$2](hermes-mention:$2)')
  return <div className="markdown-body"><Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{
    a: ({ children: content, href, ...props }) => href?.startsWith('hermes-mention:')
      ? <span className="mention-link" {...props}>{content}</span>
      : <a {...props} href={href} target="_blank" rel="noreferrer">{content}</a>,
    code: ({ className, children: content, ...props }) => {
      const value = String(content)
      return className || value.includes('\n')
        ? <CodeBlock className={className}>{content}</CodeBlock>
        : <code className="inline-code" {...props}>{content}</code>
    },
    pre: ({ children: content }) => <>{content}</>,
    table: ({ children: content }) => <div className="table-scroll"><table>{content}</table></div>,
  }}>{withMentionLinks}</Markdown></div>
}

type MessageCardProps = {
  message: LiveMessage & { local?: boolean }
  onEdit: (text: string) => void
  profile?: LiveProfile
  fallbackName: string
  revealTimestamp: boolean
  onRevealTimestamp: () => void
}

export function MessageCard({ message, onEdit, profile, fallbackName, revealTimestamp, onRevealTimestamp }: MessageCardProps) {
  const [copied, setCopied] = useState(false)
  const [swipeStartX, setSwipeStartX] = useState<number | null>(null)
  const stats = formatResponseStats(message)
  const timestamp = formatMessageTime(message.timestamp)
  const copy = async () => {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }
  const finishSwipe = (x: number) => {
    if (swipeStartX != null && swipeStartX - x > 42) onRevealTimestamp()
    setSwipeStartX(null)
  }

  if (message.role === 'system') return null
  if (message.role === 'tool') return <div className="tool-card"><span className="tool-icon"><Wrench size={14}/></span><span><b>{message.tool_name || 'Tool activity'}</b><small>Completed</small></span><Check size={15} className="tool-check"/></div>
  if (message.role === 'user') return <article className="message-row user-row"><div className="user-bubble"><MarkdownContent>{message.content}</MarkdownContent></div><div className="message-actions"><button onClick={() => void copy()}>{copied ? <Check size={13}/> : <Copy size={13}/>}<span>{copied ? 'Copied' : 'Copy'}</span></button><button onClick={() => onEdit(message.content)}>Edit</button></div></article>

  return <article className={`message-row assistant-row ${revealTimestamp ? 'timestamp-visible' : ''}`} onPointerDown={event => setSwipeStartX(event.clientX)} onPointerUp={event => finishSwipe(event.clientX)} onPointerCancel={() => setSwipeStartX(null)}>
    <div className="assistant-message-layout">
      <BotAvatar profile={profile} fallbackName={fallbackName} variant="message"/>
      <div className="assistant-message-content">
        <MarkdownContent>{message.content}</MarkdownContent>
        {stats && <div className="response-stats" aria-label="Response generation statistics">{stats}</div>}
        <div className="message-actions"><button onClick={() => void copy()}>{copied ? <Check size={13}/> : <Copy size={13}/>}<span>{copied ? 'Copied' : 'Copy'}</span></button></div>
      </div>
    </div>
    {timestamp && <time className="message-time">{timestamp}</time>}
  </article>
}
