import { describe, expect, it } from 'vitest'

import { formatViews, parseViews } from './views'

describe("a campaign's minimum views", () => {
  it('reads a minimum as he types it, and writes it back short', () => {
    expect(parseViews('1000')).toBe(1000)
    expect(parseViews('1,000')).toBe(1000)
    expect(parseViews('1k')).toBe(1000)
    expect(parseViews('1.5K')).toBe(1500)
    expect(parseViews('2m')).toBe(2_000_000)
    expect(parseViews('')).toBeNull()
    expect(parseViews('0')).toBeNull()
    expect(parseViews('lots')).toBeNull()
    expect(formatViews(1000)).toBe('1,000')
    expect(formatViews(15000)).toBe('15K')
    expect(formatViews(1_500_000)).toBe('1.5M')
  })
})
