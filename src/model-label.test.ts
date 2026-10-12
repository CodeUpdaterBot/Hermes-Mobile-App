import { describe, expect, it } from 'vitest'

import { formatModelName, modelLabel } from './model-label'

describe('formatModelName', () => {
  it('drops the redundant provider prefix from a wire model id', () => {
    expect(formatModelName('deepseek/deepseek-v4.1-flash')).toBe('deepseek-v4.1-flash')
    expect(formatModelName('openai-api/gpt-5.6-sol')).toBe('gpt-5.6-sol')
    expect(formatModelName('anthropic/claude-sonnet-4.5')).toBe('claude-sonnet-4.5')
  })

  it('keeps a bare model name untouched', () => {
    expect(formatModelName('gpt-5.6-sol')).toBe('gpt-5.6-sol')
    expect(formatModelName('deepseek-v4.1-flash')).toBe('deepseek-v4.1-flash')
  })

  it('takes only the final segment when a model id is nested', () => {
    expect(formatModelName('openrouter/deepseek/deepseek-v4.1-flash')).toBe('deepseek-v4.1-flash')
  })

  it('trims surrounding whitespace', () => {
    expect(formatModelName('  deepseek/deepseek-v4.1-flash  ')).toBe('deepseek-v4.1-flash')
  })

  it('is safe for missing or empty values', () => {
    expect(formatModelName(undefined)).toBe('')
    expect(formatModelName(null)).toBe('')
    expect(formatModelName('')).toBe('')
    expect(formatModelName('   ')).toBe('')
    expect(formatModelName('/')).toBe('/')
  })

  it('never returns a leading separator for a trailing slash', () => {
    expect(formatModelName('deepseek/')).toBe('deepseek')
  })
})

describe('modelLabel', () => {
  it('falls back when no model is resolved', () => {
    expect(modelLabel(undefined)).toBe('Hermes default')
    expect(modelLabel('')).toBe('Hermes default')
    expect(modelLabel(undefined, 'Default model')).toBe('Default model')
  })

  it('formats a resolved model', () => {
    expect(modelLabel('deepseek/deepseek-v4.1-flash')).toBe('deepseek-v4.1-flash')
  })
})
