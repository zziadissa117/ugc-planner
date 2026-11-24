import { describe, expect, it } from 'vitest'

import type { CutterViewsPost } from './campaignViews'
import {
  addDays,
  campaignWeek,
  dayLabel,
  ideateTimeLine,
  inWeek,
  notesFor,
  shortClock,
  sundayOf,
  weekName,
  weekRange,
  weekViewsByAccount,
} from './ideate'
import type { Campaign, CampaignAccount, EarningsEvent, IdeateNote, Video, VideoPost } from './schema'

// 2026-11-22 is a Sunday; the app's weeks start on Sunday.
const SUNDAY = '2026-11-22'
const TODAY = '2026-11-24'

const campaign = { id: 'c1', name: 'Login', pay_per_video_cents: 2000, pays_per_platform: false, posts_per_week: 7, min_views: 1000 } as Campaign
const account = (id: string, platform: string, extra: Partial<CampaignAccount> = {}) =>
  ({ id, campaign_id: 'c1', platform, handle: `${id}.handle`, is_active: true, bonus_only: false, pay_per_post_cents: null, ...extra }) as CampaignAccount
const tiktok = account('tt', 'TikTok')
const instagram = account('ig', 'Instagram')
const facebook = account('fb', 'Facebook', { bonus_only: true })
const accounts = [tiktok, instagram, facebook]

/** Local noon on a calendar day, as a timestamp. */
const at = (date: string, hour = 12) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, hour).toISOString()
}
const post = (id: string, video: string, acc: CampaignAccount, date: string, hour = 12) =>
  ({ id, video_id: video, account_id: acc.id, platform: acc.platform, posted_at: at(date, hour), url: null, view_count: null }) as VideoPost
const video = (id: string, extra: Partial<Video> = {}) => ({ id, campaign_id: 'c1', script: null, angle_id: null, ...extra }) as Video
const earned = (id: string, acc: string | null, cents: number, on: string, extra: Partial<EarningsEvent> = {}) =>
  ({ id, campaign_id: 'c1', video_id: 'v', account_id: acc, platform: 'TikTok', amount_cents: cents, source: 'checkoff', earned_on: on, reverses_id: null, ...extra }) as EarningsEvent

describe('the week', () => {
  it('starts on the Sunday and runs to Saturday', () => {
    expect(sundayOf('2026-11-24')).toBe(SUNDAY)
    expect(sundayOf(SUNDAY)).toBe(SUNDAY)
    expect(sundayOf('2026-11-28')).toBe(SUNDAY)
    expect(sundayOf('2026-11-29')).toBe('2026-11-29')
    expect(inWeek('2026-11-28', SUNDAY)).toBe(true)
    expect(inWeek('2026-11-29', SUNDAY)).toBe(false)
    expect(inWeek('2026-11-21', SUNDAY)).toBe(false)
    expect(addDays('2026-11-29', 7)).toBe('2026-12-06')
  })

  it('names this week and last, and gives the range for any other', () => {
    expect(weekName(SUNDAY, TODAY)).toBe('This week')
    expect(weekName('2026-11-15', TODAY)).toBe('Last week')
    expect(weekName('2026-11-08', TODAY)).toBe('Nov 8 – 14')
    expect(weekRange('2026-11-29', TODAY)).toBe('Nov 29 – Dec 5')
    expect(weekRange('2025-12-28', TODAY)).toBe('Dec 28, 2025 – Jan 3')
    expect(weekRange('2026-12-27', TODAY)).toBe('Dec 27 – Jan 2, 2027')
    expect(weekRange('2025-11-02', TODAY)).toBe('Nov 2 – 8, 2025')
    expect(dayLabel('2026-11-24')).toBe('Tue, Nov 24')
  })
})

describe('ideate time', () => {
  it('reads his ideate sessions off the saved week, Sunday first, against 2-4h', () => {
    // Stored Monday = 0: 1 is Tuesday, 3 is Thursday.
    const blocks = [
      { kind: 'ideate' as const, weekday: 3, start_minute: 600, duration_minutes: 60 },
      { kind: 'record' as const, weekday: 0, start_minute: 1080, duration_minutes: 120 },
      { kind: 'ideate' as const, weekday: 1, start_minute: 600, duration_minutes: 60 },
    ]
    expect(ideateTimeLine(blocks)).toBe('Your ideate time this week: Tue 10 am, Thu 10 am · 2h of 2–4h recommended')
    expect(ideateTimeLine(blocks.filter((b) => b.kind === 'record'))).toBeNull()
    expect(shortClock(18 * 60 + 30)).toBe('6:30 pm')
    expect(shortClock(0)).toBe('12 am')
  })
})

describe("one campaign's week", () => {
  const videos = [video('v0'), video('v1', { script: 'Hook: stop scrolling' }), video('v2')]
  const posts = [
    // Last Thursday: not this week.
    post('p0', 'v0', tiktok, '2026-11-19'),
    // v1 went to all three on Monday - one video, three ticks.
    post('p1', 'v1', tiktok, '2026-11-23', 10),
    post('p2', 'v1', instagram, '2026-11-23', 11),
    post('p3', 'v1', facebook, '2026-11-23', 12),
    post('p4', 'v2', tiktok, '2026-11-24'),
    // Someone else's campaign entirely.
    { ...post('px', 'vx', tiktok, '2026-11-24'), account_id: 'other' },
  ]
  const events = [
    earned('e0', 'tt', 1000, '2026-11-19'),
    earned('e1', 'tt', 1000, '2026-11-23'),
    earned('e2', 'ig', 1000, '2026-11-23'),
    earned('e3', 'tt', 1000, '2026-11-24'),
    // Unticked the same day: a reversal nets it out.
    earned('e4', 'tt', -1000, '2026-11-24', { source: 'reversal', reverses_id: 'e3' }),
    // A tick with no account behind it (older history).
    earned('e5', null, 500, '2026-11-25'),
    { ...earned('e6', 'tt', 9999, '2026-11-24'), campaign_id: 'c2' },
  ]

  it("counts each account's ticks in the week, and the money each one earned", () => {
    const week = campaignWeek(campaign, accounts, videos, posts, events, SUNDAY)
    const byPlatform = Object.fromEntries(week.accounts.map((a) => [a.account.platform, a]))
    expect(byPlatform.TikTok.posts.map((p) => p.post.id)).toEqual(['p1', 'p4'])
    expect(byPlatform.Instagram.posts.map((p) => p.post.id)).toEqual(['p2'])
    expect(byPlatform.Facebook.posts.map((p) => p.post.id)).toEqual(['p3'])

    expect(byPlatform.TikTok.cents).toBe(1000)
    expect(byPlatform.Instagram.cents).toBe(1000)
    expect(byPlatform.Facebook.cents).toBe(0)
    expect(week.cents).toBe(2500)
    expect(week.unlistedCents).toBe(500)
  })

  it('numbers the week\'s videos once, whichever account they went to', () => {
    const week = campaignWeek(campaign, accounts, videos, posts, events, SUNDAY)
    const all = week.accounts.flatMap((a) => a.posts)
    expect(all.find((p) => p.post.id === 'p1')).toMatchObject({ videoNumber: 1, alsoOn: ['Instagram', 'Facebook'], day: '2026-11-23' })
    expect(all.find((p) => p.post.id === 'p3')?.videoNumber).toBe(1)
    expect(all.find((p) => p.post.id === 'p4')?.videoNumber).toBe(2)
    expect(all.find((p) => p.post.id === 'p1')?.video?.script).toBe('Hook: stop scrolling')
    // Two deliverables went out, not four ticks' worth.
    expect(week.videosPosted).toBe(2)
  })

  it('does not count a bonus-only post as a deliverable, or a video first posted the week before', () => {
    const extra = [
      ...posts,
      post('p5', 'v3', facebook, '2026-11-25'),
      // v0 went out last week; cross-posting it this week is not a new video.
      post('p6', 'v0', instagram, '2026-11-25'),
    ]
    const week = campaignWeek(campaign, accounts, [...videos, video('v3')], extra, events, SUNDAY)
    expect(week.videosPosted).toBe(2)
    expect(week.accounts.find((a) => a.account.id === 'ig')?.posts).toHaveLength(2)
  })

  it('reads last week the same way', () => {
    const week = campaignWeek(campaign, accounts, videos, posts, events, '2026-11-15')
    expect(week.accounts.find((a) => a.account.id === 'tt')?.posts.map((p) => p.post.id)).toEqual(['p0'])
    expect(week.cents).toBe(1000)
    expect(week.videosPosted).toBe(1)
  })
})

describe('views', () => {
  const mine = [
    { id: 'tt', platform: 'TikTok', handle: '@login.tt' },
    { id: 'ig', platform: 'Instagram', handle: 'login.ig' },
  ]
  const { from, to } = { from: Date.parse(at(SUNDAY, 0)), to: Date.parse(at('2026-11-29', 0)) }
  const cut = (id: string, date: string, views: Record<string, number | null>, accounts = [
    { name: 'Login TT', platform: 'TikTok', profile: 'login.tt' },
    { name: 'Login IG', platform: 'Instagram', profile: 'login.ig' },
  ]): CutterViewsPost => ({ id, postedAt: at(date), accounts, views })

  it("adds up each of his accounts' readings in the week, and only his", () => {
    const result = weekViewsByAccount(
      [
        cut('a', '2026-11-23', { 'Login TT': 1500, 'Login IG': 400 }),
        cut('b', '2026-11-24', { 'Login TT': 300, 'Login IG': null }),
        // Last week: not counted.
        cut('c', '2026-11-20', { 'Login TT': 99999, 'Login IG': 99999 }),
        // Jake's post on the same cutter campaign.
        cut('d', '2026-11-24', { 'Jake TT': 50000 }, [{ name: 'Jake TT', platform: 'TikTok', profile: 'hooksandmike' }]),
      ],
      mine,
      from,
      to,
      1000,
    )
    expect(result.get('tt')).toEqual({ posts: 2, read: 2, views: 1800, reachedMin: 1 })
    expect(result.get('ig')).toEqual({ posts: 2, read: 1, views: 400, reachedMin: 0 })
  })

  it('leaves views null when nothing was read - never a zero', () => {
    const result = weekViewsByAccount([], mine, from, to, null)
    expect(result.get('tt')).toEqual({ posts: 0, read: 0, views: null, reachedMin: 0 })
  })
})

describe('notes', () => {
  const note = (id: string, account: string | null, week: string, updated: string): IdeateNote => ({
    id,
    user_id: 'u',
    campaign_id: 'c1',
    account_id: account,
    week_start: week,
    body: id,
    created_at: updated,
    updated_at: updated,
  })

  it("splits one account's notes into the week shown and the weeks before it", () => {
    const notes = [
      note('old', 'tt', '2026-11-08', '2026-11-10T00:00:00Z'),
      note('last', 'tt', '2026-11-15', '2026-11-17T00:00:00Z'),
      note('now-a', 'tt', SUNDAY, '2026-11-23T00:00:00Z'),
      note('now-b', 'tt', SUNDAY, '2026-11-24T00:00:00Z'),
      note('next', 'tt', '2026-11-29', '2026-11-30T00:00:00Z'),
      note('other-account', 'ig', SUNDAY, '2026-11-24T00:00:00Z'),
      note('campaign', null, SUNDAY, '2026-11-24T00:00:00Z'),
    ]
    const tt = notesFor(notes, 'c1', 'tt', SUNDAY)
    // Most recently edited first: that one is the box.
    expect(tt.thisWeek.map((n) => n.id)).toEqual(['now-b', 'now-a'])
    expect(tt.earlier.map((w) => w.weekStart)).toEqual(['2026-11-15', '2026-11-08'])
    expect(notesFor(notes, 'c1', null, SUNDAY).thisWeek.map((n) => n.id)).toEqual(['campaign'])
  })
})
