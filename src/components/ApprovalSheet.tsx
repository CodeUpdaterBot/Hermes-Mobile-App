import { ShieldAlert } from 'lucide-react'

import { APPROVAL_CHOICE_LABELS, type ApprovalChoice, type ApprovalRequest } from '../approvals'

type Props = {
  approval: ApprovalRequest
  /** Display name of the Bot that is blocked, when known. */
  botName: string
  /** How many more approvals are queued behind this one. */
  waiting: number
  onAnswer: (choice: ApprovalChoice) => void
}

/**
 * A Bot is blocked until the user allows or denies a dangerous command. Deny is always
 * present and is the visually quiet default; allows are explicit about their scope.
 */
export function ApprovalSheet({ approval, botName, waiting, onAnswer }: Props) {
  const allows = approval.choices.filter(choice => choice !== 'deny')
  return <section className="approval-sheet" role="alertdialog" aria-labelledby="approval-title" aria-describedby="approval-command">
    <header>
      <ShieldAlert size={18} aria-hidden/>
      <div>
        <h2 id="approval-title">{botName} needs approval</h2>
        <p>{approval.description}{approval.smartDenied ? ' · flagged as risky' : ''}</p>
      </div>
      {waiting > 0 && <span className="approval-queue" aria-label={`${waiting} more waiting`}>+{waiting}</span>}
    </header>
    {approval.command && <pre id="approval-command">{approval.command}</pre>}
    <footer>
      <button className="secondary" onClick={() => onAnswer('deny')}>{APPROVAL_CHOICE_LABELS.deny}</button>
      {allows.map(choice => <button key={choice} className={choice === 'once' ? 'primary' : 'secondary'} onClick={() => onAnswer(choice)}>{APPROVAL_CHOICE_LABELS[choice]}</button>)}
    </footer>
  </section>
}
