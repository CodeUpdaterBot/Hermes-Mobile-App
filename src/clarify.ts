/**
 * Clarify cards: the host asking the user a question mid-turn.
 *
 * Verified contract (tui_gateway/contracts/server_requests.py):
 *
 *   server request `clarify`  { questions: [{ qid, question, choices?, multi_select }] }   1-5 questions
 *   client reply              { answers: { qid: string | null } }
 *
 * A reply *without* `answers` means cancel-all, which is how the ✕ behaves. The
 * wire type for an answer is `string | null` even for a multi-select question, so
 * a multiple choice is serialised into one comma-separated string rather than sent
 * as a list the host would reject.
 */

export type ClarifyQuestion = {
  qid: string
  question: string
  choices?: string[] | null
  multi_select?: boolean
}

/** A selected choice label, or free text; multi-select holds several labels. */
export type ClarifySelection = string | string[] | null

export type ClarifyAnswers = Record<string, ClarifySelection>

export const CHOICE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const

export function choiceLetter(index: number): string {
  return CHOICE_LETTERS[index] ?? String(index + 1)
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/**
 * Tolerant decode: an unknown shape yields no questions, which leaves the turn to
 * the host's own timeout rather than showing the user a broken card.
 */
export function parseClarifyQuestions(params: unknown): ClarifyQuestion[] {
  const raw = (params ?? {}) as Record<string, unknown>
  const list = Array.isArray(raw.questions) ? raw.questions : []
  const questions: ClarifyQuestion[] = []
  for (const entry of list) {
    const item = (entry ?? {}) as Record<string, unknown>
    const qid = text(item.qid)
    const question = text(item.question)
    if (!qid || !question) continue
    const choices = Array.isArray(item.choices) ? item.choices.map(text).filter(Boolean) : null
    questions.push({ qid, question, choices, multi_select: item.multi_select === true })
  }
  return questions
}

/** Friendly heading, e.g. "Hermes has a question" / "3 questions from Hermes". */
export function clarifyTitle(count: number): string {
  return count === 1 ? 'Hermes has a question' : `${count} questions from Hermes`
}

function selectionToList(selection: ClarifySelection): string[] {
  // Whitespace-only text is not an answer; treating it as one would let the user
  // send a blank reply to a question the host is waiting on.
  if (Array.isArray(selection)) return selection.filter(item => item.trim().length > 0)
  return selection && selection.trim().length > 0 ? [selection] : []
}

/** A question counts as answered once something is selected or typed. */
export function isQuestionAnswered(selection: ClarifySelection): boolean {
  return selectionToList(selection).length > 0
}

export function clarifyComplete(questions: ClarifyQuestion[], answers: ClarifyAnswers): boolean {
  return questions.length > 0 && questions.every(question => isQuestionAnswered(answers[question.qid] ?? null))
}

/**
 * The wire result. Every question is included, with `null` for anything the user
 * skipped — the host treats a missing key differently from an explicit skip.
 */
export function buildClarifyResult(questions: ClarifyQuestion[], answers: ClarifyAnswers): { answers: Record<string, string | null> } {
  const payload: Record<string, string | null> = {}
  for (const question of questions) {
    const list = selectionToList(answers[question.qid] ?? null)
    payload[question.qid] = list.length ? list.join(', ') : null
  }
  return { answers: payload }
}

/** Toggling a choice in a multi-select question. */
export function toggleChoice(current: ClarifySelection, choice: string, multi: boolean): ClarifySelection {
  if (!multi) return choice
  const list = selectionToList(current)
  return list.includes(choice) ? list.filter(item => item !== choice) : [...list, choice]
}
