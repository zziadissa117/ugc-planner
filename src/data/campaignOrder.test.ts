// High-quality campaigns (a minimum number of views) are recorded first in a
// batch, quick ones last - and the split never reshuffles either group.

import { describe, expect, it } from 'vitest'

import { byRecordingPriority, needsHighQuality, recordingGroups } from './campaignOrder'

const c = (name: string, min_views: number | null | undefined) => ({ name, min_views }) as { name: string; min_views: number | null }

describe('recording priority', () => {
  it('puts every campaign with a minimum number of views first', () => {
    const order = byRecordingPriority([c('Quick', null), c('Strict', 1000), c('Also quick', null), c('Stricter', 5000)])
    expect(order.map((x) => x.name)).toEqual(['Strict', 'Stricter', 'Quick', 'Also quick'])
  })

  it('keeps the order each group came in', () => {
    const { highQuality, quick } = recordingGroups([c('B', 500), c('A', null), c('D', 100), c('C', null)])
    expect(highQuality.map((x) => x.name)).toEqual(['B', 'D'])
    expect(quick.map((x) => x.name)).toEqual(['A', 'C'])
  })

  it('treats a missing column as no minimum, never as one', () => {
    expect(needsHighQuality(c('Old row', undefined))).toBe(false)
    expect(needsHighQuality(c('None', null))).toBe(false)
    expect(needsHighQuality(c('Some', 1))).toBe(true)
  })
})
