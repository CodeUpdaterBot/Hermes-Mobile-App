import { describe, expect, it } from 'vitest'

import {
  buildClarifyResult,
  choiceLetter,
  clarifyComplete,
  clarifyTitle,
  isQuestionAnswered,
  parseClarifyQuestions,
  toggleChoice,
} from './clarify'

describe('choiceLetter', () => {
  it('labels choices the way the reference dialog does', () => {
    expect(choiceLetter(0)).toBe('A')
    expect(choiceLetter(3)).toBe('D')
  })

  it('degrades to a number past the letter list instead of returning undefined', () => {
    expect(choiceLetter(20)).toBe('21')
  })
})

describe('parseClarifyQuestions', () => {
  it('decodes the verified server-request shape', () => {
    const questions = parseClarifyQuestions({
      questions: [{ qid: 'q1', question: 'What do you mostly want help with?', choices: ['Work & projects', 'Writing & research'], multi_select: false }],
    })
    expect(questions).toEqual([{ qid: 'q1', question: 'What do you mostly want help with?', choices: ['Work & projects', 'Writing & research'], multi_select: false }])
  })

  it('accepts a free-text-only question (no choices)', () => {
    expect(parseClarifyQuestions({ questions: [{ qid: 'q1', question: 'Which repo?' }] })[0].choices).toBeNull()
  })

  it('drops malformed entries so a broken card is never shown', () => {
    expect(parseClarifyQuestions({ questions: [{ qid: '', question: 'no id' }, { qid: 'q2' }, null] })).toEqual([])
  })

  it('is empty for junk input rather than throwing', () => {
    expect(parseClarifyQuestions(null)).toEqual([])
    expect(parseClarifyQuestions({ questions: 'nope' })).toEqual([])
    expect(parseClarifyQuestions(undefined)).toEqual([])
  })

  it('filters blank choice labels', () => {
    expect(parseClarifyQuestions({ questions: [{ qid: 'q', question: 'Q', choices: ['A', '  ', 'B'] }] })[0].choices).toEqual(['A', 'B'])
  })
})

describe('clarifyTitle', () => {
  it('reads naturally for one and for several questions', () => {
    expect(clarifyTitle(1)).toBe('Hermes has a question')
    expect(clarifyTitle(3)).toBe('3 questions from Hermes')
  })
})

describe('isQuestionAnswered / clarifyComplete', () => {
  it('treats a single choice and free text as answered', () => {
    expect(isQuestionAnswered('Work & projects')).toBe(true)
    expect(isQuestionAnswered('   ')).toBe(false)
    expect(isQuestionAnswered(null)).toBe(false)
    expect(isQuestionAnswered([])).toBe(false)
  })

  it('requires every question before the card can be sent', () => {
    const questions = parseClarifyQuestions({ questions: [{ qid: 'a', question: 'A' }, { qid: 'b', question: 'B' }] })
    expect(clarifyComplete(questions, { a: 'x', b: 'y' })).toBe(true)
    expect(clarifyComplete(questions, { a: 'x', b: null })).toBe(false)
    expect(clarifyComplete([], {})).toBe(false)
  })
})

describe('buildClarifyResult', () => {
  it('sends every question, using null for anything skipped', () => {
    // The host distinguishes a missing key from an explicit skip.
    const questions = parseClarifyQuestions({ questions: [{ qid: 'a', question: 'A' }, { qid: 'b', question: 'B' }] })
    expect(buildClarifyResult(questions, { a: 'yes' })).toEqual({ answers: { a: 'yes', b: null } })
  })

  it('serialises a multi-select into one comma-separated string', () => {
    // The wire type is `string | null` even for multi_select, so a list would be rejected.
    const questions = parseClarifyQuestions({ questions: [{ qid: 'a', question: 'A', multi_select: true }] })
    expect(buildClarifyResult(questions, { a: ['one', 'two'] })).toEqual({ answers: { a: 'one, two' } })
  })
})

describe('toggleChoice', () => {
  it('replaces the selection for a single-select question', () => {
    expect(toggleChoice('one', 'two', false)).toBe('two')
  })

  it('adds and removes for a multi-select question', () => {
    expect(toggleChoice(['one'], 'two', true)).toEqual(['one', 'two'])
    expect(toggleChoice(['one', 'two'], 'one', true)).toEqual(['two'])
  })
})
