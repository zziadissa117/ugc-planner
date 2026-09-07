// What the work pays, and the two ways it used to get this wrong.
//
// Both real: "$105/day" from a campaign paying $35 for one post a day, because
// the account list was mistaken for a quota; and "$455/day", because a backlog
// of thirteen old videos was marked posted in one sitting and the day's total
// counted every one of them. The formula here cannot produce either: it reads
// two numbers off the campaign row and multiplies them.

import { describe, expect, it } from 'vitest'

import type { Campaign } from './data'
import {
  campaignEarnings,
  campaignsWithoutRate,
  dailyEarningsCents,
  formatCents,
  toCadCents,
  totalEarnings,
} from './money'

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'c1',
    user_id: 'u1',
    name: 'Inflow',
    company: 'Inflowpay',
    is_active: true,
    approval_mode: 'none',
    default_setup: 'face',
    daily_post_quota: 1,
    pay_per_video_cents: 3500,
    cycle_size: null,
    opening_post_count: 0,
    brief_is_incomplete: false,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('what a day pays', () => {
  it('is the rate times the posts owed per day', () => {
    expect(dailyEarningsCents(campaign())).toBe(3500)
    expect(dailyEarningsCents(campaign({ daily_post_quota: 2 }))).toBe(7000)
    expect(dailyEarningsCents(campaign({ daily_post_quota: 3 }))).toBe(10500)
  })

  it('does not change when the campaign posts to more platforms', () => {
    // The heart of it. Inflow posts one video a day to Instagram, TikTok and
    // YouTube; nothing about earnings reads the account list, so there is no
    // path by which three destinations become three payments.
    const inflow = campaign({ daily_post_quota: 1 })
    expect(dailyEarningsCents(inflow)).toBe(3500)
    expect(campaignEarnings(inflow)).toEqual({
      dayCents: 3500,
      weekCents: 24500,
      monthCents: 105000,
    })
  })

  it('is unknown, not zero, when no rate has been saved', () => {
    expect(dailyEarningsCents(campaign({ pay_per_video_cents: null }))).toBeNull()
    expect(campaignEarnings(campaign({ pay_per_video_cents: null }))).toBeNull()
  })

  it('is zero when nothing is owed per day', () => {
    expect(dailyEarningsCents(campaign({ daily_post_quota: 0 }))).toBe(0)
  })
})

describe('across campaigns', () => {
  const all = [
    campaign({ id: 'a', daily_post_quota: 1, pay_per_video_cents: 3500 }),
    campaign({ id: 'b', name: 'Vertus', daily_post_quota: 4, pay_per_video_cents: 1000 }),
    campaign({ id: 'c', name: 'Tailgate', pay_per_video_cents: null }),
  ]

  it('adds the campaigns that have a rate', () => {
    // $35 + (4 x $10). The rateless campaign contributes nothing.
    expect(totalEarnings(all).dayCents).toBe(7500)
    expect(totalEarnings(all).weekCents).toBe(52500)
    expect(totalEarnings(all).monthCents).toBe(225000)
  })

  it('names the ones with no rate rather than counting them as zero', () => {
    expect(campaignsWithoutRate(all).map((c) => c.name)).toEqual(['Tailgate'])
  })
})

describe('display', () => {
  it('renders integer cents as money', () => {
    expect(formatCents(3500)).toBe('$35.00')
    expect(formatCents(7)).toBe('$0.07')
    expect(formatCents(0)).toBe('$0.00')
  })

  it('converts to CAD in whole cents, never floats', () => {
    const cad = toCadCents(3500)
    expect(Number.isInteger(cad)).toBe(true)
    expect(cad).toBe(4795)
  })
})
