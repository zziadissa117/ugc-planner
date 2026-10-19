import { describe, expect, it } from 'vitest'

import { formatViews, parseViews, viewsTally } from './viewsTracker'

const video = (id: string, phase = 'posted', campaign_id = 'c1') => ({ id, campaign_id, phase }) as const

describe("a campaign's views tracker", () => {
  it('counts a posted video once any one account reaches the minimum', () => {
    const videos = [video('a'), video('b'), video('c'), video('d'), video('e', 'edited'), video('f', 'posted', 'other')]
    const posts = [
      // a: Instagram under, TikTok over - it counts.
      { video_id: 'a', view_count: 300 },
      { video_id: 'a', view_count: 1500 },
      // b: under everywhere.
      { video_id: 'b', view_count: 400 },
      { video_id: 'b', view_count: 600 },
      // c: exactly at it.
      { video_id: 'c', view_count: 1000 },
      // d: ticked but never read.
      { video_id: 'd', view_count: null },
      { video_id: 'f', view_count: 9000 },
    ]
    expect(viewsTally('c1', 1000, videos as never, posts)).toEqual({ posted: 4, reached: 2, under: 1, unread: 1 })
  })

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
