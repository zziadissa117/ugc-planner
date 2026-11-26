import { describe, expect, it } from 'vitest'

import type { PostizPostView } from '../sync/postizPosts'
import { dayBounds, weekBounds } from '../todaySchedule'
import { OTHER_ACCOUNTS, breakdown, goingOutRows, isShort, type GoingOutInput } from './goingOut'
import type { Campaign, CampaignAccount } from './schema'

// 2026-11-22 is a Sunday, so 24 November is a Tuesday. Local times.
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).toISOString()
const NOW = new Date(2026, 10, 24, 9)

const campaign = (id: string, name: string, extra: Partial<Campaign> = {}) =>
  ({
    id,
    name,
    is_active: true,
    min_views: null,
    pay_per_video_cents: 1000,
    posts_per_week: 7,
    daily_post_quota: 1,
    pays_per_platform: false,
    cutter_campaign_id: null,
    monthly_pay_override_cents: null,
    ...extra,
  }) as Campaign
const account = (id: string, campaignId: string, platform: string, handle: string) =>
  ({ id, campaign_id: campaignId, platform, handle, is_active: true, bonus_only: false, pay_per_post_cents: null }) as CampaignAccount

const CAMPAIGNS = [
  campaign('pump', 'Pump Fun', { daily_post_quota: 2, posts_per_week: 10 }),
  campaign('godaddy', 'GoDaddy', { daily_post_quota: 3, posts_per_week: 20, pay_per_video_cents: 2000, cutter_campaign_id: 'cut-gd' }),
  campaign('quality', 'Quality', { min_views: 1000 }),
  campaign('nothing-owed', 'Nothing owed', { daily_post_quota: 0, posts_per_week: 0 }),
  campaign('archived', 'Archived', { is_active: false, daily_post_quota: 5, posts_per_week: 35 }),
]
const ACCOUNTS = [
  account('pump-ig', 'pump', 'Instagram', 'pump.ig'),
  account('pump-tt', 'pump', 'TikTok', 'pump.tt'),
  account('pump-yt', 'pump', 'YouTube', 'pump.yt'),
  account('gd-ig', 'godaddy', 'Instagram', 'traderzi'),
]

let next = 0
const post = (extra: Partial<PostizPostView> = {}): PostizPostView => ({
  id: `p${++next}`,
  group: null,
  platform: 'TikTok',
  handle: 'pump.tt',
  url: null,
  preview: null,
  previewKind: null,
  caption: '',
  status: 'scheduled',
  publishedAt: at(24, 18),
  views: null,
  viewsAt: null,
  campaign: null,
  ...extra,
})
const godaddy = (extra: Partial<PostizPostView> = {}) =>
  post({ platform: 'Instagram', handle: 'traderzi', campaign: { id: 'cut-gd', name: 'GoDaddy' }, ...extra })

function rows(posts: PostizPostView[], span: GoingOutInput['span'] = 'today', campaigns = CAMPAIGNS) {
  const bounds = span === 'today' ? dayBounds(NOW) : weekBounds(NOW)
  return goingOutRows({ posts, campaigns, accounts: ACCOUNTS, span, ...bounds })
}
const row = (list: ReturnType<typeof rows>, key: string) => {
  const found = list.find((r) => r.key === key)
  if (!found) throw new Error(`no row ${key}`)
  return found
}

describe('going out, by campaign', () => {
  it('counts a video once, however many accounts it went to', () => {
    const list = rows([
      post({ id: 'tt', group: 'v1', platform: 'TikTok', handle: 'pump.tt', status: 'posted', url: 'https://tiktok.com/v1' }),
      post({ id: 'ig', group: 'v1', platform: 'Instagram', handle: 'pump.ig', status: 'posted', url: 'https://instagram.com/p/v1', caption: '\nThe hook\nmore' }),
      post({ id: 'yt', group: 'v1', platform: 'YouTube', handle: 'pump.yt', status: 'posted' }),
    ])
    const pump = row(list, 'pump')
    expect(pump.lined).toBe(1)
    expect(pump.videos).toHaveLength(1)
    const [video] = pump.videos
    expect(video.posts.map((p) => p.platform)).toEqual(['Instagram', 'TikTok', 'YouTube'])
    // The Instagram post's link, and the caption's first line.
    expect(video.url).toBe('https://instagram.com/p/v1')
    expect(video.caption).toBe('The hook')
    // A post with no group is a video of its own.
    expect(row(rows([post(), post()]), 'pump').lined).toBe(2)
  })

  it("puts lined up against the campaign's own quota, for today and for the week", () => {
    const posts = [
      godaddy({ group: 'a', status: 'posted', publishedAt: at(24, 8) }),
      godaddy({ group: 'b', status: 'posted', publishedAt: at(24, 12) }),
      godaddy({ group: 'c', status: 'scheduled', publishedAt: at(24, 20) }),
      godaddy({ group: 'd', status: 'posted', publishedAt: at(23, 12) }),
      godaddy({ group: 'e', status: 'posted', publishedAt: at(22, 0) }),
      // Last Saturday and next Sunday are neither today nor this week.
      godaddy({ group: 'f', status: 'posted', publishedAt: at(21, 23, 59) }),
      godaddy({ group: 'g', status: 'scheduled', publishedAt: at(29, 0) }),
    ]
    expect(row(rows(posts), 'godaddy')).toMatchObject({ lined: 3, owed: 3, counts: { posted: 2, scheduled: 1, waiting: 0, failed: 0 } })
    expect(row(rows(posts, 'week'), 'godaddy')).toMatchObject({ lined: 5, owed: 20 })
    expect(row(rows(posts), 'pump')).toMatchObject({ lined: 0, owed: 2, videos: [] })
    expect(row(rows(posts, 'week'), 'pump')).toMatchObject({ lined: 0, owed: 10 })
  })

  it('does not count a video waiting for approval, or one that failed, as lined up', () => {
    const list = rows([
      post({ status: 'posted' }),
      post({ status: 'waiting' }),
      post({ status: 'failed' }),
      // Out on one account and failed on another: it is out.
      post({ group: 'mixed', status: 'failed', platform: 'Instagram', handle: 'pump.ig' }),
      post({ group: 'mixed', status: 'posted' }),
    ])
    const pump = row(list, 'pump')
    expect(pump.counts).toEqual({ posted: 2, scheduled: 0, waiting: 1, failed: 1 })
    expect(pump.lined).toBe(2)
    expect(isShort(pump)).toBe(false)
    expect(breakdown(pump.counts)).toBe('2 out · 1 to approve · 1 failed')
  })

  it("keeps a cutter campaign the planner has no campaign for, with no quota of its own", () => {
    const trial = { id: 'cut-trial', name: 'GoDaddy traderzi2' }
    const list = rows([
      post({ group: 'x', handle: 'traderzi2', platform: 'Instagram', campaign: trial, status: 'posted' }),
      post({ group: 'x', handle: 'traderzi2', platform: 'TikTok', campaign: trial, status: 'posted' }),
      post({ group: 'y', handle: 'traderzi2', platform: 'Instagram', campaign: trial, status: 'waiting' }),
    ])
    expect(row(list, 'cutter:cut-trial')).toMatchObject({
      kind: 'cutter',
      name: 'GoDaddy traderzi2',
      lined: 1,
      owed: null,
      counts: { posted: 1, scheduled: 0, waiting: 1, failed: 0 },
    })
    expect(isShort(row(list, 'cutter:cut-trial'))).toBe(false)
  })

  it('puts posts no rule can place under Other accounts, and invents no campaign for them', () => {
    const list = rows([post({ handle: 'someone.else' }), post({ platform: 'Instagram', handle: 'pump.tt' })])
    expect(row(list, 'none')).toMatchObject({ kind: 'none', name: OTHER_ACCOUNTS, lined: 2, owed: null })
    expect(row(list, 'pump').lined).toBe(0)
  })

  it('lists campaigns still short first, in the Campaigns order, then the covered ones, the cutter ones and Other', () => {
    const big = { id: 'cut-big', name: 'Big' }
    const small = { id: 'cut-small', name: 'Small' }
    const list = rows([
      godaddy({ group: 'a', status: 'posted' }),
      godaddy({ group: 'b', status: 'posted' }),
      godaddy({ group: 'c', status: 'scheduled' }),
      post({ status: 'posted' }),
      post({ handle: 's', campaign: small, status: 'posted' }),
      post({ handle: 'b1', campaign: big, status: 'posted' }),
      post({ handle: 'b2', campaign: big, status: 'scheduled' }),
      post({ handle: 'nobody' }),
    ])
    // Quality (a minimum views) comes first in the Campaigns list, then the
    // best pay: GoDaddy, then Pump Fun. GoDaddy has its 3 of 3, so it drops
    // below the two still short. Nothing owed and archived are not listed.
    expect(list.map((r) => r.name)).toEqual(['Quality', 'Pump Fun', 'GoDaddy', 'Big', 'Small', OTHER_ACCOUNTS])
    expect(list.map((r) => [r.lined, r.owed])).toEqual([
      [0, 1],
      [1, 2],
      [3, 3],
      [2, null],
      [1, null],
      [1, null],
    ])
  })

  it('lists a campaign that owes nothing only when it has videos, and with no quota', () => {
    const extra = [...CAMPAIGNS, campaign('free', 'Free', { daily_post_quota: 0, posts_per_week: 0 })]
    const accounts = [...ACCOUNTS, account('free-tt', 'free', 'TikTok', 'free.tt')]
    const bounds = dayBounds(NOW)
    const list = goingOutRows({ posts: [post({ handle: 'free.tt' })], campaigns: extra, accounts, span: 'today', ...bounds })
    expect(list.find((r) => r.key === 'nothing-owed')).toBeUndefined()
    expect(row(list, 'free')).toMatchObject({ lined: 1, owed: null })
  })

  it('leaves out posts with no time, and keeps a video in time order', () => {
    const list = rows([post({ id: 'late', publishedAt: at(24, 21) }), post({ id: 'none', publishedAt: null }), post({ id: 'early', publishedAt: at(24, 7) })])
    expect(row(list, 'pump').videos.map((v) => v.id)).toEqual(['early', 'late'])
  })

  it('says the breakdown in words, leaving out the noughts', () => {
    expect(breakdown({ posted: 3, scheduled: 2, waiting: 1, failed: 1 })).toBe('3 out · 2 scheduled · 1 to approve · 1 failed')
    expect(breakdown({ posted: 0, scheduled: 4, waiting: 0, failed: 0 })).toBe('4 scheduled')
    expect(breakdown({ posted: 0, scheduled: 0, waiting: 0, failed: 0 })).toBe('')
  })
})
