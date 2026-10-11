import { useState } from 'react'
import { Send, X } from 'lucide-react'

import { buildClarifyResult, choiceLetter, clarifyComplete, clarifyTitle, parseClarifyQuestions, toggleChoice, type ClarifyAnswers, type ClarifyQuestion } from '../clarify'

type Props = {
  /** Raw request params straight from the host. */
  params: unknown
  /** Sends the result; omit `answers` to cancel-all. */
  onAnswer: (result: unknown) => void
}

/**
 * The clarify card: the host asking the user a question mid-turn.
 *
 * Matches the reference dialog — a heading, one row per choice with an A/B/C/D
 * key hint, and a free-text field at the bottom — and adds the parts a phone
 * needs: a scrollable body for up to five questions, an explicit send that stays
 * disabled until every question is answered, and a close that cancels the whole
 * request rather than leaving the host waiting for its timeout.
 */
export function ClarifyCard({ params, onAnswer }: Props) {
  const questions = parseClarifyQuestions(params)
  const [answers, setAnswers] = useState<ClarifyAnswers>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  if (!questions.length) return null

  const complete = clarifyComplete(questions, answers)
  const choose = (question: ClarifyQuestion, choice: string) => {
    setAnswers(current => ({ ...current, [question.qid]: toggleChoice(current[question.qid] ?? null, choice, question.multi_select === true) }))
  }
  const type = (question: ClarifyQuestion, value: string) => {
    setDrafts(current => ({ ...current, [question.qid]: value }))
    // Typing replaces a choice: the free-text field is the authoritative answer.
    setAnswers(current => ({ ...current, [question.qid]: value.trim() ? value : null }))
  }
  const send = () => onAnswer(buildClarifyResult(questions, answers))
  // A reply without `answers` is cancel-all, which is what the contract defines.
  const cancel = () => onAnswer({})

  return <section className="clarify-card" role="dialog" aria-label={clarifyTitle(questions.length)}>
    <header className="clarify-head">
      <div>
        <b>{clarifyTitle(questions.length)}</b>
        {questions.length === 1 && <small>Pick whatever&rsquo;s closest, we can always expand from there.</small>}
      </div>
      <button className="clarify-close" onClick={cancel} aria-label="Cancel the question"><X size={15}/></button>
    </header>

    <div className="clarify-body">
      {questions.map(question => {
        const selection = answers[question.qid] ?? null
        const selected = Array.isArray(selection) ? selection : selection ? [selection] : []
        return <div className="clarify-question" key={question.qid}>
          {questions.length > 1 && <p className="clarify-prompt">{question.question}</p>}
          {!!question.choices?.length && <div className="clarify-choices">
            {question.choices.map((choice, index) => <button
              key={choice}
              className={`clarify-choice${selected.includes(choice) ? ' selected' : ''}`}
              onClick={() => choose(question, choice)}
              aria-pressed={selected.includes(choice)}
            ><i>{choiceLetter(index)}</i><span>{choice}</span></button>)}
          </div>}
          <input
            className="clarify-input"
            value={drafts[question.qid] ?? (typeof selection === 'string' && !question.choices?.includes(selection) ? selection : '')}
            onChange={event => type(question, event.target.value)}
            placeholder={question.choices?.length ? 'Type your own answer' : 'Type your answer'}
            aria-label={question.choices?.length ? 'Type your own answer' : question.question}
          />
        </div>
      })}
    </div>

    <footer className="clarify-actions">
      <button className="secondary" onClick={cancel}>Skip</button>
      <button className="primary" disabled={!complete} onClick={send}><Send size={14}/> Send</button>
    </footer>
  </section>
}
