import { describe, expect, it } from 'vitest'

import { BALANCED_SETTINGS, findSilentRanges, keepRanges, totalDuration, type Level } from './silenceMath'

/** Builds a level curve: loud for `loudSec`, then quiet for `quietSec`, repeated. */
function pattern(pairs: Array<[loudSec: number, quietSec: number]>, stepSec = 0.05): Level[] {
  const levels: Level[] = []
  let t = 0
  for (const [loudSec, quietSec] of pairs) {
    for (let i = 0; i < loudSec / stepSec; i++, t += stepSec) levels.push({ time: t, db: -10 })
    for (let i = 0; i < quietSec / stepSec; i++, t += stepSec) levels.push({ time: t, db: -50 })
  }
  return levels
}

describe('findSilentRanges', () => {
  it('finds a pause long enough to count', () => {
    const levels = pattern([[1, 1]])
    const silences = findSilentRanges(levels, BALANCED_SETTINGS)
    expect(silences).toHaveLength(1)
    expect(silences[0].start).toBeCloseTo(1, 1)
    expect(silences[0].end).toBeCloseTo(2, 1)
  })

  it('ignores a pause shorter than the minimum', () => {
    // Balanced settings cut only pauses of 0.4s or more.
    const levels = pattern([[1, 0.2]])
    expect(findSilentRanges(levels, BALANCED_SETTINGS)).toHaveLength(0)
  })

  it('closes a silence that runs to the end of the file', () => {
    const levels = pattern([[1, 1]])
    const silences = findSilentRanges(levels, BALANCED_SETTINGS)
    expect(silences.at(-1)?.end).toBeCloseTo(2, 1)
  })

  it('finds every pause in a longer clip, in order', () => {
    const levels = pattern([
      [1, 0.5],
      [2, 1],
      [0.5, 0.8],
    ])
    const silences = findSilentRanges(levels, BALANCED_SETTINGS)
    expect(silences).toHaveLength(3)
    expect(silences[0].start).toBeCloseTo(1, 1)
    expect(silences[1].start).toBeCloseTo(3.5, 1)
    expect(silences[2].start).toBeCloseTo(5, 1)
  })
})

describe('keepRanges', () => {
  it('keeps the whole clip when nothing is silent', () => {
    expect(keepRanges([], 10, 0.12)).toEqual([{ start: 0, end: 10 }])
  })

  it('cuts a silent middle section, padding both sides', () => {
    const kept = keepRanges([{ start: 4, end: 6 }], 10, 0.12)
    expect(kept).toEqual([
      { start: 0, end: 4.12 },
      { start: 5.88, end: 10 },
    ])
  })

  it('cuts silence touching the start/end flush, but still pads the inward edge', () => {
    // Silence at the very start/end is cut right to the edge - there's no
    // word beyond the edge to protect. The edge closest to speech still gets
    // its padding, so the first and last words aren't clipped.
    const kept = keepRanges(
      [
        { start: 0, end: 1 },
        { start: 9, end: 10 },
      ],
      10,
      0.12,
    )
    expect(kept).toEqual([{ start: 0.88, end: 9.12 }])
  })

  it('drops a leftover sliver shorter than the minimum keep length', () => {
    // A 0.05s gap between two adjacent silences isn't worth keeping.
    const kept = keepRanges(
      [
        { start: 1, end: 3 },
        { start: 3.15, end: 5 },
      ],
      10,
      0.05,
    )
    // 3.05 -> 3.10 is 0.05s wide, under the 0.1s minimum, so it's dropped.
    expect(kept.some((r) => r.end - r.start < 0.1)).toBe(false)
  })

  it('never produces a range that starts after it ends', () => {
    const kept = keepRanges([{ start: 2, end: 3 }], 5, 5) // padding wider than the clip
    for (const r of kept) expect(r.end).toBeGreaterThan(r.start)
  })
})

describe('totalDuration', () => {
  it('sums range lengths', () => {
    expect(
      totalDuration([
        { start: 0, end: 2 },
        { start: 5, end: 6.5 },
      ]),
    ).toBeCloseTo(3.5)
  })
})
