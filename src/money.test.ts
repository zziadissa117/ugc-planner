// The money rules, which are the ones a wrong answer does the most damage to.
//
// Pure computation over rows, so these build the rows by hand.

import { describe, expect, it } from 'vitest'

import type { BonusClaim, BonusTier, Campaign, CampaignField, Video } from './data'
import { summariseCampaignMoney, totalMoney } from './money'

const USER = 'u'
let seq = 0

const campaign = (overrides: Partial<Campaign> = {}): Campaign => ({
  id: 'c1',
  user_id: USER,
  name: 'Inflow',
  company: 'Inflowpay',
  is_active: true,
  approval_mode: 'video',
  default_setup: 'face',
  daily_post_quota: 1,
  pay_per_video_cents: 3500,
  cycle_size: 60,
  opening_post_count: 13,
  brief_is_incomplete: true,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  ...overrides,
})

const posted = (rateCents: number | null, campaignId = 'c1'): Video => {
  seq++
  return {
    id: `v${seq}`,
    user_id: USER,
    campaign_id: campaignId,
    kind: 'contracted',
    setup: 'face',
    angle_id: null,
    phase: 'posted',
    script: null,
    blocked_reason: null,
    owed_for_date: null,
    rate_snapshot_cents: rateCents,
    posted_at: '2026-09-02T10:00:00.000Z',
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
  }
}

const unposted = (campaignId = 'c1'): Video => ({ ...posted(null, campaignId), phase: 'edited' })

const tier = (payoutCents: number, id = 't1'): BonusTier => ({
  id,
  user_id: USER,
  campaign_id: 'c1',
  label: `${payoutCents} bonus`,
  threshold_views: 50_000,
  payout_cents: payoutCents,
  view_window_days: 30,
  updated_at: '2026-09-01T00:00:00.000Z',
})

const claim = (
  videoId: string,
  tierId: string,
  overrides: Partial<BonusClaim> = {},
): BonusClaim => ({
  id: `b-${videoId}-${tierId}`,
  user_id: USER,
  video_id: videoId,
  bonus_tier_id: tierId,
  probability: 0,
  received_cents: null,
  received_at: null,
  updated_at: '2026-09-01T00:00:00.000Z',
  ...overrides,
})

describe('DOCUMENTED base earned', () => {
  it('is posted videos times the rate each one locked in at', () => {
    const videos = [posted(3500), posted(3500), posted(4000)]
    const money = summariseCampaignMoney(campaign(), videos, [], [])

    expect(money.documentedCents).toBe(11_000)
    expect(money.pricedPostedCount).toBe(3)
  })

  it('uses each video own snapshot, not the campaign current rate', () => {
    // The rate went up. Work already posted keeps what it earned at.
    const videos = [posted(3500), posted(5000)]
    const money = summariseCampaignMoney(campaign({ pay_per_video_cents: 5000 }), videos, [], [])

    expect(money.documentedCents).toBe(8500)
  })

  it('counts nothing for videos that are not posted', () => {
    const money = summariseCampaignMoney(campaign(), [unposted(), unposted()], [], [])
    expect(money.documentedCents).toBe(0)
    expect(money.postedInAppCount).toBe(0)
  })

  it('excludes posted videos whose rate is still unknown', () => {
    const videos = [posted(3500), posted(null), posted(null)]
    const money = summariseCampaignMoney(campaign(), videos, [], [])

    // Not counted as $35 each, and not counted as $0 each either.
    expect(money.documentedCents).toBe(3500)
    expect(money.pricedPostedCount).toBe(1)
    expect(money.unpricedPostedCount).toBe(2)
  })
})

describe('EXPECTED bonus', () => {
  it('is zero until the user types a probability', () => {
    const video = posted(3500)
    const money = summariseCampaignMoney(
      campaign(),
      [video],
      [tier(5000)],
      [claim(video.id, 't1')],
    )
    expect(money.expectedBonusCents).toBe(0)
  })

  it('is payout times the probability he gave it', () => {
    const video = posted(3500)
    const money = summariseCampaignMoney(
      campaign(),
      [video],
      [tier(5000)],
      [claim(video.id, 't1', { probability: 0.25 })],
    )
    expect(money.expectedBonusCents).toBe(1250)
  })

  it('stays in whole cents', () => {
    const video = posted(3500)
    const money = summariseCampaignMoney(
      campaign(),
      [video],
      [tier(3333)],
      [claim(video.id, 't1', { probability: 0.33 })],
    )
    expect(Number.isInteger(money.expectedBonusCents)).toBe(true)
    expect(money.expectedBonusCents).toBe(1100)
  })

  it('is never added to money actually received', () => {
    const video = posted(3500)
    const money = summariseCampaignMoney(
      campaign(),
      [video],
      [tier(5000)],
      [
        claim(video.id, 't1', {
          probability: 0.5,
          received_cents: 5000,
          received_at: '2026-09-03T00:00:00.000Z',
        }),
      ],
    )
    // The same claim contributes to both figures separately. They are two
    // different statements about it and are never combined.
    expect(money.expectedBonusCents).toBe(2500)
    expect(money.receivedBonusCents).toBe(5000)
  })
})

describe('USER ENTERED bonus', () => {
  it('counts only what was logged as received', () => {
    const a = posted(3500)
    const b = posted(3500)
    const money = summariseCampaignMoney(
      campaign(),
      [a, b],
      [tier(5000)],
      [
        claim(a.id, 't1', { received_cents: 5000, received_at: '2026-09-03T00:00:00.000Z' }),
        claim(b.id, 't1', { probability: 0.9 }),
      ],
    )
    // The 90% one is not money. It has not arrived.
    expect(money.receivedBonusCents).toBe(5000)
  })
})

describe('the three figures are never summed', () => {
  it('exposes no combined total', () => {
    const video = posted(3500)
    const totals = totalMoney([
      summariseCampaignMoney(
        campaign(),
        [video],
        [tier(5000)],
        [
          claim(video.id, 't1', {
            probability: 0.5,
            received_cents: 5000,
            received_at: '2026-09-03T00:00:00.000Z',
          }),
        ],
      ),
    ])

    expect(totals.documentedCents).toBe(3500)
    expect(totals.expectedBonusCents).toBe(2500)
    expect(totals.receivedBonusCents).toBe(5000)
    // Whatever a "total" would be, there is no field holding it.
    expect(Object.keys(totals).sort()).toEqual([
      'documentedCents',
      'expectedBonusCents',
      'receivedBonusCents',
      'unpricedPostedCount',
    ])
  })
})

describe('the opening balance', () => {
  it('counts toward the cycle without contributing money', () => {
    const money = summariseCampaignMoney(campaign({ opening_post_count: 13 }), [], [], [])

    expect(money.openingPostCount).toBe(13)
    expect(money.cyclePosition).toBe(13)
    // 13 posts times $35 would be a fabricated $455 of earnings history.
    expect(money.documentedCents).toBe(0)
  })

  it('adds to posts made in the app for cycle position', () => {
    const money = summariseCampaignMoney(
      campaign({ opening_post_count: 13 }),
      [posted(3500), posted(3500)],
      [],
      [],
    )
    expect(money.cyclePosition).toBe(15)
    expect(money.postedInAppCount).toBe(2)
    expect(money.documentedCents).toBe(7000)
  })
})

describe('the opening balance rate', () => {
  const rateField = (overrides: Partial<CampaignField> = {}): CampaignField => ({
    id: 'f1',
    user_id: USER,
    campaign_id: 'c1',
    field_key: 'opening_balance_rate_cents',
    field_value: '3500',
    source: 'user_entered',
    source_quote: null,
    source_document_id: null,
    confirmed_at: '2026-09-04T00:00:00.000Z',
    updated_at: '2026-09-04T00:00:00.000Z',
    ...overrides,
  })

  it('is unknown until he confirms one', () => {
    const money = summariseCampaignMoney(campaign(), [], [], [], [])
    expect(money.openingBalanceRateCents).toBeNull()
    expect(money.openingBalanceCents).toBeNull()
  })

  it('is never derived from the campaign current rate', () => {
    // The campaign pays $35.00 today. That says nothing about what the posts
    // carried over from before the app existed were paid at.
    const money = summariseCampaignMoney(campaign({ pay_per_video_cents: 3500 }), [], [], [], [])
    expect(money.openingBalanceRateCents).toBeNull()
  })

  it('values the carried-over posts once he confirms a rate', () => {
    const money = summariseCampaignMoney(campaign(), [], [], [], [rateField()])
    expect(money.openingBalanceRateCents).toBe(3500)
    expect(money.openingBalanceCents).toBe(45_500) // 13 x $35.00
  })

  it('stays out of the per-video documented total', () => {
    const money = summariseCampaignMoney(campaign(), [posted(3500)], [], [], [rateField()])
    // The two figures are reported side by side, not added together.
    expect(money.documentedCents).toBe(3500)
    expect(money.openingBalanceCents).toBe(45_500)
  })

  it('ignores a rate he typed but never confirmed', () => {
    const money = summariseCampaignMoney(campaign(), [], [], [], [rateField({ confirmed_at: null })])
    expect(money.openingBalanceCents).toBeNull()
  })

  it('ignores a missing field, and one holding something that is not cents', () => {
    expect(
      summariseCampaignMoney(
        campaign(),
        [],
        [],
        [],
        [rateField({ source: 'missing', field_value: null })],
      ).openingBalanceCents,
    ).toBeNull()

    expect(
      summariseCampaignMoney(campaign(), [], [], [], [rateField({ field_value: '35.50' })])
        .openingBalanceCents,
    ).toBeNull()
  })

  it('does not read another campaign rate', () => {
    const money = summariseCampaignMoney(
      campaign(),
      [],
      [],
      [],
      [rateField({ campaign_id: 'c2' })],
    )
    expect(money.openingBalanceCents).toBeNull()
  })
})

describe('the payment cycle', () => {
  it('reports 13 of 60 for a freshly carried-over Inflow', () => {
    const money = summariseCampaignMoney(campaign(), [], [], [])
    expect(money.postsIntoCurrentCycle).toBe(13)
    expect(money.cycleSize).toBe(60)
  })

  it('is not payable until a cycle closes', () => {
    const money = summariseCampaignMoney(campaign(), [posted(3500)], [], [])
    expect(money.completedCycles).toBe(0)
    expect(money.isPayable).toBe(false)
  })

  it('becomes payable once 60 deliverables are in', () => {
    const videos = Array.from({ length: 47 }, () => posted(3500))
    const money = summariseCampaignMoney(campaign({ opening_post_count: 13 }), videos, [], [])

    expect(money.cyclePosition).toBe(60)
    expect(money.completedCycles).toBe(1)
    expect(money.postsIntoCurrentCycle).toBe(0)
    expect(money.isPayable).toBe(true)
  })

  it('treats a campaign with no cycle as paid per post', () => {
    const money = summariseCampaignMoney(campaign({ cycle_size: null }), [posted(3500)], [], [])
    expect(money.completedCycles).toBe(0)
    expect(money.isPayable).toBe(true)
  })
})

describe('the unpriced count', () => {
  it('offers a backfill only once the campaign has a rate', () => {
    const withRate = summariseCampaignMoney(campaign(), [posted(null)], [], [])
    expect(withRate.unpricedPostedCount).toBe(1)
    expect(withRate.canBackfill).toBe(true)

    const withoutRate = summariseCampaignMoney(
      campaign({ pay_per_video_cents: null }),
      [posted(null)],
      [],
      [],
    )
    expect(withoutRate.unpricedPostedCount).toBe(1)
    expect(withoutRate.canBackfill).toBe(false)
  })
})

describe('campaign isolation', () => {
  it('does not count another campaign videos', () => {
    const videos = [posted(3500, 'c1'), posted(9900, 'c2')]
    const money = summariseCampaignMoney(campaign(), videos, [], [])
    expect(money.documentedCents).toBe(3500)
  })
})
