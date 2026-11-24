import { describe, expect, it } from 'vitest'

import type { PostizPostView } from '../sync/postizPosts'
import {
  addDays,
  campaignsInOrder,
  dayLabel,
  hasHandles,
  periodRange,
  postsForCampaign,
  sundayOf,
  videoStats,
  videosForCampaign,
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

describe("a campaign's posts", () => {
  it('keeps only posts that went out on one of its accounts, matched by platform and exact handle', () => {
    const posts = [
      post('older', { publishedAt: '2026-11-22T10:00:00.000Z' }),
      post('ig', { platform: 'Instagram', handle: 'LOGIN.IG', publishedAt: '2026-11-24T10:00:00.000Z' }),
      // Same handle, wrong platform: not this campaign's.
      post('wrong-platform', { platform: 'YouTube' }),
      // Another campaign's account.
      post('elsewhere', { handle: 'elsewhere' }),
      // A near miss is someone else's.
      post('near-miss', { handle: 'login.tt2' }),
      // Not out yet, or never went out.
      post('scheduled', { status: 'scheduled' }),
      post('failed', { status: 'failed' }),
    ]
    const mine = postsForCampaign(posts, accounts, 'c1')
    expect(mine.map((p) => [p.post.id, p.accountId])).toEqual([
      ['older', 'tt'],
      ['ig', 'ig'],
    ])
  })

  it('matches nothing for an account switched off, or a campaign with no handles', () => {
    expect(postsForCampaign([post('a')], [account('tt', 'TikTok', 'login.tt', { is_active: false })], 'c1')).toEqual([])
    expect(postsForCampaign([post('a')], [account('tt', 'TikTok', null)], 'c1')).toEqual([])
    expect(hasHandles([account('tt', 'TikTok', ' @ ')], 'c1')).toBe(false)
    expect(hasHandles(accounts, 'c1')).toBe(true)
  })
})

describe("a campaign's videos", () => {
  const ig = (id: string, extra: Partial<PostizPostView> = {}) =>
    post(id, { platform: 'Instagram', handle: 'login.ig', preview: null, previewKind: null, url: `https://www.instagram.com/reel/${id}`, ...extra })

  it('makes one video of the posts that share a group, newest first, and one of a post with none', () => {
    const videos = videosForCampaign(
      [
        post('tt-1', { group: 'g1', publishedAt: '2026-11-23T10:00:00Z', views: 900, preview: 'https://cdn/x.jpg', previewKind: 'image' }),
        ig('ig-1', { group: 'g1', publishedAt: '2026-11-23T10:01:00Z', views: 300 }),
        post('alone', { publishedAt: '2026-11-24T09:00:00Z', views: 50 }),
        // In the group, but not out.
        ig('ig-2', { group: 'g1', status: 'failed', views: 99999 }),
      ],
      accounts,
      'c1',
    )
    expect(videos.map((v) => v.id)).toEqual(['alone', 'g1'])
    const g1 = videos[1]
    // Instagram first; one deliverable, its platforms' views added up.
    expect(g1.posts.map((p) => p.post.id)).toEqual(['ig-1', 'tt-1'])
    expect(g1.views).toBe(1200)
    expect(g1.publishedAt).toBe('2026-11-23T10:00:00Z')
  })

  it("opens on Instagram when it went there, and borrows another platform's preview", () => {
    const [video] = videosForCampaign(
      [post('tt', { group: 'g', preview: 'https://cdn/tt.jpg', previewKind: 'image' }), ig('ig', { group: 'g' })],
      accounts,
      'c1',
    )
    expect(video.primary.post.id).toBe('ig')
    expect(video.preview).toEqual({ src: 'https://cdn/tt.jpg', kind: 'image' })
  })

  it('opens wherever there is a link when Instagram has none, and has no preview when none of its posts does', () => {
    const [video] = videosForCampaign(
      [post('tt', { group: 'g', preview: null, previewKind: null }), ig('ig', { group: 'g', url: null })],
      accounts,
      'c1',
    )
    expect(video.primary.post.id).toBe('tt')
    expect(video.preview).toBeNull()
  })

  it('leaves views unknown until one of its platforms has been read, and counts the platforms still to come', () => {
    const [partly, none] = videosForCampaign(
      [
        post('a', { group: 'g1', views: 400, publishedAt: '2026-11-24T10:00:00Z' }),
        ig('b', { group: 'g1', views: null, publishedAt: '2026-11-24T10:00:00Z' }),
        post('c', { group: 'g2', views: null, publishedAt: '2026-11-23T10:00:00Z' }),
      ],
      accounts,
      'c1',
    )
    expect(partly).toMatchObject({ views: 400, unread: 1 })
    expect(none).toMatchObject({ views: null, unread: 1 })
  })
})

describe('the figures', () => {
  const videos = (list: PostizPostView[]) => videosForCampaign(list, accounts, 'c1')

  it('averages, ranks and picks best and worst per video, from read views only', () => {
    const stats = videoStats(
      videos([
        post('a', { views: 1200, publishedAt: '2026-11-22T10:00:00Z' }),
        post('b', { views: 300, publishedAt: '2026-11-23T10:00:00Z' }),
        post('c', { views: null, publishedAt: '2026-11-24T10:00:00Z' }),
        // One video on two platforms: 4,500 in all.
        post('d', { group: 'g', views: 4000, publishedAt: '2026-11-24T12:00:00Z' }),
        post('e', { group: 'g', platform: 'Instagram', handle: 'login.ig', views: 500, publishedAt: '2026-11-24T12:00:00Z' }),
      ]),
    )
    expect(stats.posted).toBe(4)
    expect(stats.read).toBe(3)
    // (1200 + 300 + 4500) / 3 - the unread one is not a zero.
    expect(stats.average).toBe(2000)
    expect(stats.best?.id).toBe('g')
    expect(stats.worst?.id).toBe('b')
  })

  it('has no average, best or worst until something is read, and no worst from a single video', () => {
    const none = videoStats(videos([post('a'), post('b')]))
    expect(none).toEqual({ posted: 2, read: 0, average: null, best: null, worst: null })

    const one = videoStats(videos([post('a', { views: 0 }), post('b')]))
    expect(one.average).toBe(0)
    expect(one.best?.id).toBe('a')
    expect(one.worst).toBeNull()
  })

  it('says views are coming in only while the server is still reading', () => {
    const list = videos([post('a', { views: 10 }), post('b'), post('c')])
    expect(viewsComingIn(list, 5)).toBe(2)
    expect(viewsComingIn(list, 0)).toBe(0)
  })
})

describe('campaign order', () => {
  const campaign = (id: string, extra: Partial<Campaign> = {}) =>
    ({ id, name: id, is_active: true, min_views: null, pay_per_video_cents: 1000, posts_per_week: 7, pays_per_platform: false, ...extra }) as Campaign

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
