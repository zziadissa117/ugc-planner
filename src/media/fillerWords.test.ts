import { describe, expect, it } from 'vitest'

import { fillerWordRanges } from './fillerWords'
import type { Level } from './silenceMath'

/** A level curve at 20ms steps from [fromSec, toSec, dB] spans. */
function curve(spans: Array<[from: number, to: number, db: number]>): Level[] {
  const levels: Level[] = []
  for (const [from, to, db] of spans) {
    for (let t = from; t < to - 1e-9; t += 0.02) levels.push({ time: Number(t.toFixed(3)), db })
  }
  return levels
}

/** "so" ... gap ... "um" ... gap ... "then" - the ordinary case. */
const spacedOut = curve([
  [0, 0.6, -12],
  [0.6, 0.9, -60],
  [0.9, 1.3, -20],
  [1.3, 1.6, -60],
  [1.6, 2.4, -12],
])

const spacedWords = [
  { text: ' so', start: 0, end: 0.6 },
  { text: ' um', start: 0.9, end: 1.3 },
  { text: ' then', start: 1.6, end: 2.4 },
]

describe('fillerWordRanges', () => {
  it('cuts the filler along with the dead air around it', () => {
    const [range] = fillerWordRanges(spacedWords, spacedOut, { guardSec: 0.04 })
    expect(range).toBeDefined()
    // Opened out into the gaps either side, not clamped to the word itself.
    expect(range.start).toBeLessThan(0.9)
    expect(range.end).toBeGreaterThan(1.3)
  })

  it('never reaches into the word before or the word after', () => {
    const [range] = fillerWordRanges(spacedWords, spacedOut, { guardSec: 0.04 })
    // "so" ends at 0.6 and "then" starts at 1.6. The cut has to stay inside.
    expect(range.start).toBeGreaterThanOrEqual(0.6)
    expect(range.end).toBeLessThanOrEqual(1.6)
  })

  it('leaves real words alone entirely', () => {
    const noFillers = [
      { text: ' so', start: 0, end: 0.6 },
      { text: ' then', start: 1.6, end: 2.4 },
    ]
    expect(fillerWordRanges(noFillers, spacedOut, { guardSec: 0.04 })).toEqual([])
  })

  it('refuses when the filler is reported on top of the next word', () => {
    // This is the "connections" case: the recogniser puts the filler's end
    // inside the following word, leaving no corridor at all.
    const crowded = [
      { text: ' and', start: 0, end: 0.5 },
      { text: ' uh', start: 0.5, end: 0.54 },
      { text: ' connections', start: 0.5, end: 1.2 },
    ]
    expect(fillerWordRanges(crowded, spacedOut, { guardSec: 0.04 })).toEqual([])
  })

  it('does not let a cut swallow a short word next to the filler', () => {
    // "And, uh, my" - all three tight together. Whatever comes back must not
    // cover "And" or "my".
    const tight = [
      { text: ' And', start: 3.84, end: 3.92 },
      { text: ' uh', start: 4.0, end: 4.08 },
      { text: ' my', start: 4.2, end: 4.54 },
    ]
    const levels = curve([
      [3.8, 3.94, -14],
      [3.94, 4.0, -55],
      [4.0, 4.1, -20],
      [4.1, 4.2, -55],
      [4.2, 4.6, -14],
    ])
    for (const range of fillerWordRanges(tight, levels, { guardSec: 0.04 })) {
      expect(range.start).toBeGreaterThanOrEqual(3.92)
      expect(range.end).toBeLessThanOrEqual(4.2)
    }
  })

  it('treats a run of fillers as one corridor between the real words', () => {
    const run = [
      { text: ' so', start: 0, end: 0.6 },
      { text: ' um', start: 0.9, end: 1.1 },
      { text: ' uh', start: 1.15, end: 1.3 },
      { text: ' then', start: 1.6, end: 2.4 },
    ]
    for (const range of fillerWordRanges(run, spacedOut, { guardSec: 0.04 })) {
      expect(range.start).toBeGreaterThanOrEqual(0.6)
      expect(range.end).toBeLessThanOrEqual(1.6)
    }
  })

  it('is case-insensitive and ignores punctuation', () => {
    const upper = [
      { text: ' so', start: 0, end: 0.6 },
      { text: ' Um,', start: 0.9, end: 1.3 },
      { text: ' then', start: 1.6, end: 2.4 },
    ]
    expect(fillerWordRanges(upper, spacedOut, { guardSec: 0.04 })).toHaveLength(1)
  })

  it('leaves a real word that merely starts like a filler', () => {
    const umbrella = [
      { text: ' so', start: 0, end: 0.6 },
      { text: ' umbrella', start: 0.9, end: 1.3 },
      { text: ' then', start: 1.6, end: 2.4 },
    ]
    expect(fillerWordRanges(umbrella, spacedOut, { guardSec: 0.04 })).toEqual([])
  })
})
