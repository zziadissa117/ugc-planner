// What the work pays, and the two ways it used to get this wrong.
//
// Both real: "$105/day" from a campaign paying $35 for one post a day, because
// the account list was mistaken for a quota; and "$455/day", because a backlog
// of thirteen old videos was marked posted in one sitting and the day's total
// counted every one of them. The formula here cannot produce either: it reads
// two numbers off the campaign row and multiplies them.

import { describe, expect, it } from 'vitest'

import type { Campaign, CampaignAccount } from './data'
import {
  campaignEarnings,
  campaignIsLive,
  campaignsWithoutRate,
  dailyEarningsCents,
  formatCents,
  hasMonthlyOverride,
  monthlyPayCents,
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
    monthly_pay_override_cents: null,
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


describe('what a month pays', () => {
  it('estimates it as rate x posts per day x 30', () => {
    expect(monthlyPayCents(campaign())).toBe(105000)
    expect(monthlyPayCents(campaign({ daily_post_quota: 3, pay_per_video_cents: 1666 }))).toBe(
      149940,
    )
  })

  it('is unknown when there is no rate and no correction', () => {
    expect(monthlyPayCents(campaign({ pay_per_video_cents: null }))).toBeNull()
  })

  it('uses his own figure over the estimate', () => {
    // Pump.Fun is a retainer and Inflow pays per completed 60-post cycle:
    // neither can be said as a per-video rate, so the estimate is wrong and he
    // corrects it.
    const corrected = campaign({ monthly_pay_override_cents: 200000 })
    expect(hasMonthlyOverride(corrected)).toBe(true)
    expect(monthlyPayCents(corrected)).toBe(200000)
  })

  it('treats a missing field as no correction rather than as a figure', () => {
    // A row pulled from the server before this column existed arrives without
    // it. Reading that absence as a number turned every total into NaN.
    const stale = campaign()
    delete (stale as Partial<Campaign>).monthly_pay_override_cents
    expect(hasMonthlyOverride(stale)).toBe(false)
    expect(monthlyPayCents(stale)).toBe(105000)
  })

  it('works the day and week back from his figure so the three agree', () => {
    const corrected = campaign({ monthly_pay_override_cents: 90000 })
    expect(campaignEarnings(corrected)).toEqual({
      dayCents: 3000,
      weekCents: 21000,
      monthCents: 90000,
    })
  })

  it('adds his corrected months up exactly, not from a rounded day', () => {
    // 100001 does not divide evenly by thirty. The month he typed is the
    // number he is owed, so it is summed as typed.
    const totals = totalEarnings([campaign({ monthly_pay_override_cents: 100001 })])
    expect(totals.monthCents).toBe(100001)
  })

  it('stops calling a campaign unrated once he has given it a month', () => {
    const corrected = campaign({ pay_per_video_cents: null, monthly_pay_override_cents: 50000 })
    expect(campaignsWithoutRate([corrected])).toEqual([])
  })
})

describe('whether a campaign counts at all', () => {
  function account(overrides: Partial<CampaignAccount> = {}): CampaignAccount {
    return {
      id: 'a1',
      user_id: 'u1',
      campaign_id: 'c1',
      platform: 'Instagram',
      handle: '@me',
      email: null,
      password: null,
      posts_per_day: 0,
      status: 'ready',
      is_active: true,
      sort_order: 0,
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
      ...overrides,
    }
  }

  it('counts when one switched-on account is ready', () => {
    expect(campaignIsLive(campaign(), [account()])).toBe(true)
  })

  it('does not count a campaign with no accounts', () => {
    expect(campaignIsLive(campaign(), [])).toBe(false)
  })

  it('does not count while every account is new or warming', () => {
    expect(campaignIsLive(campaign(), [account({ status: 'new' })])).toBe(false)
    expect(campaignIsLive(campaign(), [account({ status: 'warming' })])).toBe(false)
  })

  it('ignores an account that is switched off, however ready it is', () => {
    expect(campaignIsLive(campaign(), [account({ is_active: false })])).toBe(false)
  })

  it('never counts an archived campaign', () => {
    expect(campaignIsLive(campaign({ is_active: false }), [account()])).toBe(false)
  })

  it('does not pay more for a second ready account', () => {
    // Pay is per campaign. One ready account is the whole test; a second adds
    // a destination, not a payment.
    const one = campaignIsLive(campaign(), [account()])
    const two = campaignIsLive(campaign(), [account(), account({ id: 'a2', platform: 'TikTok' })])
    expect(one).toBe(two)
    expect(totalEarnings([campaign()]).monthCents).toBe(105000)
  })

  it('adds up his real campaigns the way the screen will', () => {
    // From the live database on 16 Sep. Lock in App has two accounts, both
    // New, so it is the one left out.
    const inflow = campaign({ id: 'inflow', pay_per_video_cents: 3500, daily_post_quota: 1 })
    const pump = campaign({ id: 'pump', pay_per_video_cents: 1666, daily_post_quota: 3 })
    const vertus = campaign({ id: 'vertus', pay_per_video_cents: 1000, daily_post_quota: 2 })
    const lockIn = campaign({ id: 'lockin', pay_per_video_cents: 1785, daily_post_quota: 1 })

    const accounts = [
      account({ id: 'i1', campaign_id: 'inflow' }),
      account({ id: 'p1', campaign_id: 'pump' }),
      account({ id: 'v1', campaign_id: 'vertus' }),
      account({ id: 'l1', campaign_id: 'lockin', status: 'new' }),
      account({ id: 'l2', campaign_id: 'lockin', platform: 'TikTok', status: 'new' }),
    ]

    const all = [inflow, pump, vertus, lockIn]
    const live = all.filter((c) => campaignIsLive(c, accounts))
    expect(live.map((c) => c.id)).toEqual(['inflow', 'pump', 'vertus'])
    expect(totalEarnings(live).monthCents).toBe(314940)
    expect(monthlyPayCents(lockIn)).toBe(53550)
  })
})
