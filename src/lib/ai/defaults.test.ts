import { describe, it, expect } from 'vitest'
import { splitReplyIntoMessages, MAX_REPLY_PARTS } from './defaults'

describe('splitReplyIntoMessages', () => {
  it('returns a single-element array for a reply with no blank-line breaks', () => {
    expect(splitReplyIntoMessages('Sure, I can help with that!')).toEqual([
      'Sure, I can help with that!',
    ])
  })

  it('splits on blank lines into separate messages', () => {
    expect(splitReplyIntoMessages('First part.\n\nSecond part.')).toEqual([
      'First part.',
      'Second part.',
    ])
  })

  it('trims each part and drops empty ones from stray blank lines', () => {
    expect(splitReplyIntoMessages('  First.  \n\n\n\n  Second.  ')).toEqual([
      'First.',
      'Second.',
    ])
  })

  it('caps at MAX_REPLY_PARTS, folding overflow into the last part', () => {
    const result = splitReplyIntoMessages('One.\n\nTwo.\n\nThree.\n\nFour.\n\nFive.')
    expect(result).toHaveLength(MAX_REPLY_PARTS)
    expect(result).toEqual(['One.', 'Two.', 'Three.\n\nFour.\n\nFive.'])
  })

  it('returns an empty array for empty/whitespace-only input', () => {
    expect(splitReplyIntoMessages('   ')).toEqual([])
    expect(splitReplyIntoMessages('')).toEqual([])
  })
})
