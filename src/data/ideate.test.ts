import { describe, expect, it } from 'vitest'

import type { PostizPostView } from '../sync/postizPosts'
import {
  ALL,
  NO_HOME,
  NO_HOME_NAME,
  addDays,
  byAccount,
  byCampaign,
  byDay,
  byPlatform,
  campaignsInOrder,
  compactViews,
  dayLabel,
  hasHandles,
  headlineViews,
  homeOptions,
  ideateVideos,
  isLeftOutOfAll,
  median,
  percent,
  periodDays,
  periodRange,
  standouts,
  sundayOf,
  videoStats,
  videosForAll,
  videosIn,
  viewsComingIn,
  weekName,
  weekRange,
} from './ideate'
import type { Campaign, CampaignAccount } from './schema'

// 2026-11-22 is a Sunday; the app's weeks start on Sunday.
const SUNDAY = '2026-11-22'
const TODAY = '2026-11-24'

const account = (id: string, platform: string, handle: string | null, extra: Partial<CampaignAccount> = {}) =>
  ({ id, campaign_id: 'c1', platform, handle, is_active: true, bonus_only: false, pay_per_post_cents: null, ...extra }) as CampaignAccount
const tiktok = account('tt', 'TikTok', '@Login.TT')
const instagram = account('ig', 'Instagram', 'login.ig')
const accounts = [tiktok, instagram, account('other', 'TikTok', 'elsewhere', { campaign_id: 'c2' })]

const post = (id: string, extra: Partial<PostizPostView> = {}): PostizPostView => ({
  id,
  group: null,
  platform: 'TikTok',
  handle: 'login.tt',
  url: `https://www.tiktok.com/@login.tt/video/${id}`,
  preview: null,
  previewKind: null,
  caption: '',
  status: 'posted',
  publishedAt: '2026-11-23T15:00:00.000Z',
  views: null,
  viewsAt: null,
  campaign: null,
  ...extra,
})

describe('days and weeks', () => {
  it('starts the week on the Sunday', () => {
    expect(sundayOf('2026-11-24')).toBe(SUNDAY)
    expect(sundayOf(SUNDAY)).toBe(SUNDAY)
    expect(sundayOf('2026-11-28')).toBe(SUNDAY)
    expect(sundayOf('2026-11-29')).toBe('2026-11-29')
    expect(addDays('2026-11-29', 7)).toBe('2026-12-06')
  })

  it('names this week and last, and gives the range for any other', () => {
    expect(weekName(SUNDAY, TODAY)).toBe('This week')
    expect(weekName('2026-11-15', TODAY)).toBe('Last week')
    expect(weekName('2026-11-08', TODAY)).toBe('Nov 8 – 14')
    expect(weekRange('2026-11-29', TODAY)).toBe('Nov 29 – Dec 5')
    expect(weekRange('2025-12-28', TODAY)).toBe('Dec 28, 2025 – Jan 3')
    expect(dayLabel('2026-11-24')).toBe('Tue, Nov 24')
  })
})

describe('the period', () => {
  // Tuesday afternoon, local time.
  const now = new Date(2026, 10, 24, 15, 0)
  const local = (y: number, m: number, d: number) => new Date(y, m - 1, d).toISOString()

  it('runs this week from Sunday midnight to the next Sunday', () => {
    expect(periodRange('week', now)).toEqual({ from: local(2026, 11, 22), to: local(2026, 11, 29), weekStart: SUNDAY })
  })

  it('runs last week up to this Sunday, and files its notes under that week', () => {
    expect(periodRange('last-week', now)).toEqual({ from: local(2026, 11, 15), to: local(2026, 11, 22), weekStart: '2026-11-15' })
  })

  it('runs 30 days as today and the 29 before it', () => {
    expect(periodRange('30-days', now)).toEqual({ from: local(2026, 10, 26), to: local(2026, 11, 25), weekStart: SUNDAY })
  })
})

// --- Videos -------------------------------------------------------------------

const campaign = (id: string, extra: Partial<Campaign> = {}) =>
  ({ id, name: id, is_active: true, min_views: null, cutter_campaign_id: null, pay_per_video_cents: 1000, posts_per_week: 7, ...extra }) as Campaign
// c1 is "Login", posting on @login.tt and login.ig; c2 another campaign;
// c3 the planner's campaign for the cutter's "Vertus".
const campaigns = [
  campaign('c1', { name: 'Login' }),
  campaign('c2', { name: 'Inflow' }),
  campaign('c3', { name: 'Vertus', cutter_campaign_id: 'cut-vertus' }),
]
const cutter = (id: string, name: string) => ({ id, name })
const build = (list: PostizPostView[]) => ideateVideos(list, campaigns, accounts)
const ig = (id: string, extra: Partial<PostizPostView> = {}) =>
  post(id, { platform: 'Instagram', handle: 'login.ig', preview: null, previewKind: null, url: `https://www.instagram.com/reel/${id}`, ...extra })

describe('every video that went out', () => {
  it('places each by homeOfPost: exact account, the linked cutter campaign, the cutter campaign by name, or none', () => {
    const videos = build([
      post('login', { publishedAt: '2026-11-24T10:00:00.000Z' }),
      post('elsewhere', { handle: 'elsewhere', publishedAt: '2026-11-24T09:00:00.000Z' }),
      // Linked to Vertus, on an account the planner does not list.
      post('vertus', { handle: 'unlisted', campaign: cutter('cut-vertus', 'Vertus'), publishedAt: '2026-11-24T08:00:00.000Z' }),
      // A cutter campaign the planner has no campaign for: still his video.
      post('gd', { handle: 'traderzi2', campaign: cutter('cut-gd', 'GoDaddy traderzi2'), publishedAt: '2026-11-24T07:00:00.000Z' }),
      // A near miss is nobody's.
      post('stray', { handle: 'login.tt2', publishedAt: '2026-11-24T06:00:00.000Z' }),
    ])
    expect(videos.map((v) => [v.id, v.homeKey, v.posts[0].accountId])).toEqual([
      ['login', 'c1', 'tt'],
      ['elsewhere', 'c2', 'other'],
      ['vertus', 'c3', null],
      ['gd', 'cutter:cut-gd', null],
      ['stray', 'none', null],
    ])
    expect(videos[3].home).toEqual({ kind: 'cutter', cutterId: 'cut-gd', name: 'GoDaddy traderzi2' })
  })

  it('leaves out what did not go out: scheduled, waiting for approval, failed', () => {
    const videos = build([
      post('out'),
      post('scheduled', { status: 'scheduled' }),
      post('waiting', { status: 'waiting' }),
      post('failed', { status: 'failed' }),
    ])
    expect(videos.map((v) => v.id)).toEqual(['out'])
  })

  it('makes one video of the posts that share a group, newest first, and one of a post with none', () => {
    const videos = build([
      post('tt-1', { group: 'g1', publishedAt: '2026-11-23T10:00:00Z', views: 900, preview: 'https://cdn/x.jpg', previewKind: 'image' }),
      ig('ig-1', { group: 'g1', publishedAt: '2026-11-23T10:01:00Z', views: 300 }),
      post('alone', { publishedAt: '2026-11-24T09:00:00Z', views: 50 }),
      // In the group, but not out.
      ig('ig-2', { group: 'g1', status: 'failed', views: 99999 }),
    ])
    expect(videos.map((v) => v.id)).toEqual(['alone', 'g1'])
    const g1 = videos[1]
    // Instagram first; one deliverable, its platforms' views added up.
    expect(g1.posts.map((p) => p.post.id)).toEqual(['ig-1', 'tt-1'])
    expect(g1.views).toBe(1200)
    expect(g1.publishedAt).toBe('2026-11-23T10:00:00Z')
    expect(g1.homeKey).toBe('c1')
  })

  it('never splits a video: a group lands where most of its posts do, and only those posts keep their account', () => {
    const [video] = build([
      post('a', { group: 'g', campaign: cutter('cut-x', 'X') }),
      ig('b', { group: 'g', campaign: cutter('cut-x', 'X') }),
      post('c', { group: 'g', platform: 'YouTube', handle: 'nobody', campaign: cutter('cut-x', 'X') }),
    ])
    expect(video.homeKey).toBe('c1')
    expect(video.posts.map((p) => [p.post.id, p.accountId])).toEqual([
      ['b', 'ig'],
      ['a', 'tt'],
      ['c', null],
    ])
  })

  it("opens on Instagram when it went there, and borrows another platform's preview", () => {
    const [video] = build([post('tt', { group: 'g', preview: 'https://cdn/tt.jpg', previewKind: 'image' }), ig('ig', { group: 'g' })])
    expect(video.primary.post.id).toBe('ig')
    expect(video.preview).toEqual({ src: 'https://cdn/tt.jpg', kind: 'image' })
  })

  it("keeps the cutter's video file as a video preview", () => {
    const [video] = build([ig('ig', { preview: 'https://cdn/v.mp4', previewKind: 'video', campaign: cutter('cut-vertus', 'Vertus') })])
    expect(video.preview).toEqual({ src: 'https://cdn/v.mp4', kind: 'video' })
  })

  it('opens wherever there is a link when Instagram has none, and has no preview when none of its posts does', () => {
    const [video] = build([post('tt', { group: 'g', preview: null, previewKind: null }), ig('ig', { group: 'g', url: null })])
    expect(video.primary.post.id).toBe('tt')
    expect(video.preview).toBeNull()
  })

  it('leaves views unknown until one of its platforms has been read, and counts the platforms still to come', () => {
    const [partly, none] = build([
      post('a', { group: 'g1', views: 400, publishedAt: '2026-11-24T10:00:00Z' }),
      ig('b', { group: 'g1', views: null, publishedAt: '2026-11-24T10:00:00Z' }),
      post('c', { group: 'g2', views: null, publishedAt: '2026-11-23T10:00:00Z' }),
    ])
    expect(partly).toMatchObject({ views: 400, unread: 1 })
    expect(none).toMatchObject({ views: null, unread: 1 })
  })

  it('scopes to one campaign, or to all of them', () => {
    const videos = build([post('a'), post('b', { handle: 'elsewhere' }), post('c', { handle: 'x', campaign: cutter('cut-gd', 'GD') })])
    expect(videosIn(videos, 'c1').map((v) => v.id)).toEqual(['a'])
    expect(videosIn(videos, 'cutter:cut-gd').map((v) => v.id)).toEqual(['c'])
    expect(videosIn(videos, ALL)).toHaveLength(3)
  })
})

// --- Figures -------------------------------------------------------------------

describe('the figures', () => {
  const at = (day: number) => `2026-11-${day}T10:00:00Z`

  it('counts every video out, and totals, averages, takes the median and ranks from read views only', () => {
    const stats = videoStats(
      build([
        post('a', { views: 1200, publishedAt: at(20) }),
        post('b', { views: 300, publishedAt: at(21) }),
        post('c', { views: null, publishedAt: at(22) }),
        // One video on two platforms: 4,500 in all.
        post('d', { group: 'g', views: 4000, publishedAt: at(23) }),
        ig('e', { group: 'g', views: 500, publishedAt: at(23) }),
        post('f', { views: 12_000, publishedAt: at(24) }),
      ]),
    )
    expect(stats.posted).toBe(5)
    expect(stats.read).toBe(4)
    // 1200 + 300 + 4500 + 12000 - the unread one is not a zero.
    expect(stats.total).toBe(18_000)
    expect(stats.average).toBe(4500)
    // 300, 1200, 4500, 12000: between the middle two.
    expect(stats.median).toBe(2850)
    expect(stats.best?.id).toBe('f')
    expect(stats.worst?.id).toBe('b')
    // Of the four read: three at 1,000 or more, one at 10,000 or more.
    expect(stats.over1k).toEqual({ hits: 3, of: 4, share: 0.75 })
    expect(stats.over10k).toEqual({ hits: 1, of: 4, share: 0.25 })
  })

  it('has no total, average, median, best, worst or hit rate until something is read', () => {
    const none = videoStats(build([post('a'), post('b')]))
    expect(none).toEqual({
      posted: 2,
      read: 0,
      total: null,
      average: null,
      median: null,
      best: null,
      worst: null,
      over1k: null,
      over10k: null,
    })
  })

  it('has no worst from a single read video, and reads a real zero as zero', () => {
    const one = videoStats(build([post('a', { views: 0 }), post('b')]))
    expect(one.average).toBe(0)
    expect(one.median).toBe(0)
    expect(one.best?.id).toBe('a')
    expect(one.worst).toBeNull()
  })

  it('takes the middle value as the median of an odd count', () => {
    expect(median([5, 1, 9])).toBe(5)
    expect(median([])).toBeNull()
  })

  it("picks what's working: up to three best and three weakest, never the same video twice", () => {
    const list = (n: number) => build(Array.from({ length: n }, (_, i) => post(`v${i + 1}`, { views: (i + 1) * 100, publishedAt: at(10 + i) })))
    const ids = (v: { id: string }[]) => v.map((x) => x.id)

    const seven = standouts(list(7))
    expect(ids(seven.best)).toEqual(['v7', 'v6', 'v5'])
    // Worst first.
    expect(ids(seven.weakest)).toEqual(['v1', 'v2', 'v3'])

    const four = standouts(list(4))
    expect(ids(four.best)).toEqual(['v4', 'v3', 'v2'])
    expect(ids(four.weakest)).toEqual(['v1'])

    const two = standouts(list(2))
    expect(ids(two.best)).toEqual(['v2'])
    expect(ids(two.weakest)).toEqual(['v1'])

    expect(ids(standouts(list(1)).weakest)).toEqual([])
    expect(standouts(build([post('unread')]))).toEqual({ best: [], weakest: [] })
  })

  it('says views are coming in only while the server is still reading', () => {
    const list = build([post('a', { views: 10 }), post('b'), post('c')])
    expect(viewsComingIn(list, 5)).toBe(2)
    expect(viewsComingIn(list, 0)).toBe(0)
  })
})

// --- Breakdowns ------------------------------------------------------------------

describe('the campaign picker', () => {
  const videos = build([
    post('a'),
    post('b'),
    post('c', { handle: 'x', campaign: cutter('cut-gd', 'GoDaddy traderzi2') }),
    post('d', { handle: 'y', campaign: cutter('cut-big', 'Big one') }),
    post('e', { handle: 'z', campaign: cutter('cut-big', 'Big one') }),
    post('f', { handle: 'stray' }),
  ])

  it('offers everything first, then every planner campaign - empty ones too - then cutter-only ones, most videos first', () => {
    const options = homeOptions(campaigns, videos)
    expect(options.map((o) => [o.key, o.name, o.count])).toEqual([
      [ALL, 'All campaigns', 6],
      ['c1', 'Login', 2],
      ['c2', 'Inflow', 0],
      ['c3', 'Vertus', 0],
      ['cutter:cut-big', 'Big one', 2],
      ['cutter:cut-gd', 'GoDaddy traderzi2', 1],
      [NO_HOME, NO_HOME_NAME, 1],
    ])
    expect(options[1]).toMatchObject({ kind: 'campaign', campaignId: 'c1' })
    expect(options[4]).toMatchObject({ kind: 'cutter', campaignId: null })
  })

  it('knows no counts before the videos are read, and keeps a chosen cutter campaign in place', () => {
    const options = homeOptions(campaigns, null, [{ key: 'cutter:cut-gd', name: 'GoDaddy traderzi2' }])
    expect(options.map((o) => [o.key, o.count])).toEqual([
      [ALL, null],
      ['c1', null],
      ['c2', null],
      ['c3', null],
      ['cutter:cut-gd', null],
    ])
    expect(homeOptions(campaigns, [], [{ key: 'cutter:cut-gd', name: 'GD' }]).at(-1)).toMatchObject({ key: 'cutter:cut-gd', count: 0 })
  })
})

describe('by campaign, platform, account and day', () => {
  const videos = build([
    post('a', { views: 1000, publishedAt: '2026-11-22T15:00:00Z' }),
    ig('a-ig', { group: 'ga', views: 500, publishedAt: '2026-11-23T15:00:00Z' }),
    post('a-tt', { group: 'ga', views: 1500, publishedAt: '2026-11-23T15:00:00Z' }),
    post('b', { handle: 'elsewhere', views: null, publishedAt: '2026-11-23T15:00:00Z' }),
    post('c', { handle: 'x', platform: 'YouTube', campaign: cutter('cut-gd', 'GoDaddy traderzi2'), views: 9000, publishedAt: '2026-11-24T15:00:00Z' }),
  ])

  it('ranks campaigns by views, with cutter-only ones under their own name', () => {
    const rows = byCampaign(videos, homeOptions(campaigns, videos))
    expect(rows).toEqual([
      { key: 'cutter:cut-gd', name: 'GoDaddy traderzi2', videos: 1, read: 1, total: 9000, average: 9000, best: 9000 },
      { key: 'c1', name: 'Login', videos: 2, read: 2, total: 3000, average: 1500, best: 2000 },
      // Nothing read: it went out, and its views are unknown - not zero.
      { key: 'c2', name: 'Inflow', videos: 1, read: 0, total: null, average: null, best: null },
    ])
  })

  it('counts platforms per post, so a video on two is a post on each', () => {
    expect(byPlatform(videos)).toEqual([
      { platform: 'YouTube', posts: 1, read: 1, views: 9000, average: 9000 },
      { platform: 'TikTok', posts: 3, read: 2, views: 2500, average: 1250 },
      { platform: 'Instagram', posts: 1, read: 1, views: 500, average: 500 },
    ])
  })

  it("lists a campaign's accounts, best average first", () => {
    const rows = byAccount(videosIn(videos, 'c1'))
    expect(rows.map((r) => [r.key, r.platform, r.handle, r.posts, r.average, r.best])).toEqual([
      ['tt', 'TikTok', 'login.tt', 2, 1250, 1500],
      ['ig', 'Instagram', 'login.ig', 1, 500, 500],
    ])
    // An account the planner does not list still gets a row of its own.
    expect(byAccount(videosIn(videos, 'cutter:cut-gd'))).toMatchObject([{ key: 'youtube|x', handle: 'x', accountId: null, posts: 1 }])
  })

  it('gives every day of the period, the empty ones too, averaging only what was read', () => {
    const days = ['2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25']
    const rows = byDay(videos, days)
    expect(rows.map((r) => [r.day, r.videos, r.read, r.average])).toEqual([
      ['2026-11-22', 1, 1, 1000],
      // The unread one is out that day, and left out of its average.
      ['2026-11-23', 2, 1, 2000],
      ['2026-11-24', 1, 1, 9000],
      ['2026-11-25', 0, 0, null],
    ])
  })
})

describe('handles', () => {
  it('needs a switched-on account with a real handle', () => {
    expect(hasHandles([account('tt', 'TikTok', ' @ ')], 'c1')).toBe(false)
    expect(hasHandles([account('tt', 'TikTok', 'login.tt', { is_active: false })], 'c1')).toBe(false)
    expect(hasHandles(accounts, 'c1')).toBe(true)
  })
})

describe('the days of a period', () => {
  const now = new Date(2026, 10, 24, 15, 0)
  it('runs a week Sunday to Saturday, and thirty days up to today', () => {
    expect(periodDays('week', now)).toEqual(['2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28'])
    expect(periodDays('last-week', now)[0]).toBe('2026-11-15')
    const thirty = periodDays('30-days', now)
    expect(thirty).toHaveLength(30)
    expect([thirty[0], thirty[29]]).toEqual(['2026-10-26', '2026-11-24'])
  })
})

describe('views as he reads them', () => {
  it('writes them the way the platforms do', () => {
    expect([0, 850, 999, 1000, 1234, 12_400, 99_960, 123_456, 999_499, 999_500, 1_234_567, 12_000_000].map(compactViews)).toEqual([
      '0',
      '850',
      '999',
      '1K',
      '1.2K',
      '12.4K',
      '100K',
      '123K',
      '999K',
      '1M',
      '1.2M',
      '12M',
    ])
    expect(headlineViews(2000)).toBe('2,000')
    expect(headlineViews(48_200)).toBe('48.2K')
    expect(percent(0.756)).toBe('76%')
  })
})

describe('campaign order', () => {
  it('puts high-quality campaigns first, best pay first within each, and leaves archived ones out', () => {
    const ordered = campaignsInOrder(
      [
        campaign('quick-low', { pay_per_video_cents: 500 }),
        campaign('quick-high', { pay_per_video_cents: 3000 }),
        campaign('quality', { min_views: 1000, pay_per_video_cents: 100 }),
        campaign('archived', { is_active: false, min_views: 1000 }),
      ],
      [],
    )
    expect(ordered.map((c) => c.id)).toEqual(['quality', 'quick-high', 'quick-low'])
  })
})

describe('his personal brand, left out of All campaigns', () => {
  const personal = (id: string, extra: Partial<PostizPostView> = {}) =>
    post(id, { platform: 'Instagram', handle: 'ziadtps', url: `https://www.instagram.com/reel/${id}/`, ...extra })

  it('knows the account by platform and exact handle only', () => {
    expect(isLeftOutOfAll({ platform: 'Instagram', handle: 'ziadtps' })).toBe(true)
    expect(isLeftOutOfAll({ platform: 'Instagram', handle: '@ZiadTPS' })).toBe(true)
    expect(isLeftOutOfAll({ platform: 'TikTok', handle: 'ziadtps' })).toBe(false)
    expect(isLeftOutOfAll({ platform: 'Instagram', handle: 'ziadtps2' })).toBe(false)
  })

  it('takes its videos and views out of All campaigns, and keeps them under their own campaign', () => {
    const videos = build([
      post('a', { views: 400 }),
      personal('b', { views: 90_000, campaign: cutter('cut-trial', 'Trial reels') }),
      personal('c', { views: 50_000 }),
    ])
    const all = videosIn(videos, ALL)
    expect(all.map((v) => v.id)).toEqual(['a'])
    expect(videoStats(all).total).toBe(400)
    expect(videosForAll(videos).leftOut).toBe(2)
    expect(homeOptions(campaigns, videos)[0]).toMatchObject({ key: ALL, count: 1 })
    // Picked on its own, it is all there.
    expect(videosIn(videos, 'cutter:cut-trial').map((v) => v.views)).toEqual([90_000])
    expect(videosIn(videos, NO_HOME).map((v) => v.views)).toEqual([50_000])
  })

  it('counts a video posted there and on a campaign account by the campaign account alone', () => {
    const videos = build([
      post('tt', { group: 'v1', views: 1_200 }),
      personal('ig', { group: 'v1', views: 80_000 }),
    ])
    const [video] = videosIn(videos, ALL)
    expect(video.views).toBe(1_200)
    expect(video.posts.map((p) => p.post.id)).toEqual(['tt'])
    expect(video.primary.post.id).toBe('tt')
    expect(videosIn(videos, 'c1')[0].views).toBe(81_200)
  })
})
