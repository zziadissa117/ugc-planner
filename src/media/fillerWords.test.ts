import { describe, expect, it } from 'vitest'

import { fillerWordRanges } from './fillerWords'

describe('fillerWordRanges', () => {
  it('cuts a recognized filler word, padded like a silent pause', () => {
    const ranges = fillerWordRanges([{ text: ' um', start: 2, end: 2.3 }], 0.1)
    expect(ranges).toEqual([{ start: 1.9, end: 2.4 }])
  })

  it('is case-insensitive and ignores punctuation Whisper attaches to a word', () => {
    const ranges = fillerWordRanges([{ text: ' Um,', start: 0, end: 0.3 }], 0)
    expect(ranges).toHaveLength(1)
  })

  it('leaves a real word alone even if it starts the same way', () => {
    // "umbrella" contains "um" but is not a filler word.
    expect(fillerWordRanges([{ text: ' umbrella', start: 0, end: 0.6 }], 0.1)).toEqual([])
  })

  it('never produces a negative start even with padding near the beginning', () => {
    const ranges = fillerWordRanges([{ text: 'uh', start: 0.05, end: 0.15 }], 0.2)
    expect(ranges[0].start).toBe(0)
  })

  it('recognizes several common spellings', () => {
    const words = ['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'hmm']
    const chunks = words.map((text, i) => ({ text, start: i, end: i + 0.2 }))
    expect(fillerWordRanges(chunks, 0)).toHaveLength(words.length)
  })

  it('only cuts recognized fillers out of a mixed transcript', () => {
    const chunks = [
      { text: ' So', start: 0, end: 0.3 },
      { text: ' um', start: 0.3, end: 0.6 },
      { text: ' basically', start: 0.6, end: 1.1 },
    ]
    expect(fillerWordRanges(chunks, 0)).toEqual([{ start: 0.3, end: 0.6 }])
  })
})
