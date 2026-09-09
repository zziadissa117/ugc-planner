import { describe, expect, it } from 'vitest'

import { localToday } from './index'
import type { VideoPost } from './schema'
import { postingStreak } from './streak'

const TODAY = '2026-09-09'

/** A post on a given local day, at midday so no zone shifts it. */
function post(date: string, videoId = crypto.randomUUID()): VideoPost {
  const [y, m, d] = date.split('-').map(Number)
  return {
    id: crypto.randomUUID(),
    user_id: 'u',
    video_id: videoId,
    account_id: null,
    platform: 'TikTok',
    url: null,
    view_count: null,
    view_count_entered_at: null,
    posted_at: new Date(y, m - 1, d, 12).toISOString(),
    updated_at: new Date(y, m - 1, d, 12).toISOString(),
  }
}

describe('the posting streak', () => {
  it('is nothing when he has never posted', () => {
    expect(postingStreak([], TODAY)).toEqual({ days: 0, includesToday: false })
  })

  it('counts today and the unbroken run before it', () => {
    const posts = ['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09'].map((d) => post(d))
    expect(postingStreak(posts, TODAY)).toEqual({ days: 4, includesToday: true })
  })

  it('stays alive while today is still empty', () => {
    // A day that is not over yet must not end it - that is the pressure.
    const posts = ['2026-09-07', '2026-09-08'].map((d) => post(d))
    expect(postingStreak(posts, TODAY)).toEqual({ days: 2, includesToday: false })
  })

  it('is broken once a whole day was missed', () => {
    const posts = ['2026-09-05', '2026-09-06'].map((d) => post(d))
    expect(postingStreak(posts, TODAY)).toEqual({ days: 0, includesToday: false })
  })

  it('counts a day once however many platforms it went out on', () => {
    // Same video, three destinations - one day, not three.
    const shared = crypto.randomUUID()
    const posts = [post(TODAY, shared), post(TODAY, shared), post(TODAY, shared)]
    expect(postingStreak(posts, TODAY)).toEqual({ days: 1, includesToday: true })
  })

  it('crosses a month boundary', () => {
    const posts = ['2026-08-30', '2026-08-31', '2026-09-01'].map((d) => post(d))
    expect(postingStreak(posts, '2026-09-01')).toEqual({ days: 3, includesToday: true })
  })

  it('reads the day in his own zone, not UTC', () => {
    // A post made late in the evening belongs to that evening's date, which is
    // the same rule the posting board and the day's count use.
    const late = post(TODAY)
    late.posted_at = new Date(2026, 8, 9, 23, 30).toISOString()
    expect(localToday(new Date(late.posted_at))).toBe(TODAY)
    expect(postingStreak([late], TODAY).includesToday).toBe(true)
  })
})
