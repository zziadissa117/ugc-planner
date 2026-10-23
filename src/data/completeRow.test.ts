// completeRow: a row an older build wrote without the columns added since
// gets them the way the database would - null where null is allowed, the
// SQL default otherwise - and nothing already there moves.

import { describe, expect, it } from 'vitest'

import { assertRow, completeRow } from './constraints'
import { SQL_COLUMNS, TABLE_NAMES } from './schema'

const USER = '11111111-1111-4111-8111-111111111111'
const stamp = '2026-10-01T00:00:00.000Z'

/** A campaign as the first release stored it: none of the later columns. */
const OLD_CAMPAIGN = {
  id: 'c1',
  user_id: USER,
  name: 'Vertus',
  company: null,
  is_active: true,
  approval_mode: 'none',
  default_setup: 'face',
  daily_post_quota: 2,
  pay_per_video_cents: 3500,
  cycle_size: null,
  opening_post_count: 0,
  brief_is_incomplete: false,
  created_at: stamp,
  updated_at: stamp,
}

describe('completeRow', () => {
  it('fills the columns an old campaign row never had, so it validates and does not crash a screen', () => {
    const row = completeRow('campaigns', OLD_CAMPAIGN)
    expect(row.min_views).toBeNull()
    expect(row.archived_at).toBeNull()
    expect(row.cutter_campaign_id).toBeNull()
    expect(row.post_position).toBeNull()
    expect(row.payout_date).toBeNull()
    expect(row.monthly_pay_override_cents).toBeNull()
    expect(row.pays_per_platform).toBe(false)
    expect(row.needs_submission).toBe(false)
    expect(row.payout_schedule).toBe('none')
    // Seven times the daily quota he had set - the v8 / 0016 arithmetic.
    expect(row.posts_per_week).toBe(14)
    expect(() => assertRow('campaigns', row)).not.toThrow()
  })

  it('never touches a value that is there, null included', () => {
    const row = completeRow('campaigns', { ...OLD_CAMPAIGN, min_views: 1000, posts_per_week: 3, pays_per_platform: true, company: null })
    expect(row.min_views).toBe(1000)
    expect(row.posts_per_week).toBe(3)
    expect(row.pays_per_platform).toBe(true)
    expect(row.company).toBeNull()
  })

  it('gives an account its later columns', () => {
    const row = completeRow('campaign_accounts', {
      id: 'a1', user_id: USER, campaign_id: 'c1', platform: 'TikTok', handle: null, posts_per_day: 0,
      status: 'new', is_active: true, sort_order: 0, created_at: stamp, updated_at: stamp,
    })
    expect(row.bonus_only).toBe(false)
    expect(row.pay_per_post_cents).toBeNull()
    expect(row.email).toBeNull()
    expect(row.password).toBeNull()
    expect(() => assertRow('campaign_accounts', row)).not.toThrow()
  })

  it('gives a post its views columns and leaves an id alone', () => {
    const row = completeRow('video_posts', { id: 'p1', user_id: USER, video_id: 'v1', platform: 'TikTok', posted_at: stamp, updated_at: stamp })
    expect(row.view_count).toBeNull()
    expect(row.view_count_entered_at).toBeNull()
    expect(row.url).toBeNull()
    expect(row.account_id).toBeNull()
    expect(row.id).toBe('p1')
    // An id the database would mint is not invented here: a row without one
    // is refused by the validator, as before.
    const noId = completeRow('video_posts', { user_id: USER, video_id: 'v1', platform: 'TikTok', posted_at: stamp, updated_at: stamp })
    expect(noId.id).toBeUndefined()
  })

  it('knows every column of every table', () => {
    for (const table of TABLE_NAMES) {
      expect(SQL_COLUMNS[table].length).toBeGreaterThan(0)
      expect(SQL_COLUMNS[table].some((c) => c.name === 'user_id')).toBe(true)
    }
    // Every nullable column of every table ends up present after a fill.
    for (const table of TABLE_NAMES) {
      const filled = completeRow(table, {}) as unknown as Record<string, unknown>
      for (const column of SQL_COLUMNS[table]) {
        if (column.nullable) expect(filled).toHaveProperty(column.name, null)
      }
    }
  })
})
