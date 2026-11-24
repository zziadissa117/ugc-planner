import { describe, expect, it } from 'vitest'

import {
  type Allowance,
  type CachedPost,
  CUTTER_READ_SHARE,
  MAX_RANGE_DAYS,
  PLANNER_POSTIZ_PER_HOUR,
  SHARED_POSTIZ_PER_HOUR,
  afterTooMany,
  answerFrom,
  awaitingViews,
  checkRange,
  cleanHandle,
  grant,
  isTikTokVideo,
  keyFingerprint,
  oembedThumbnail,
  oembedUrl,
  parseCutterUse,
  parseIntegrations,
  parsePostList,
  pickDue,
  pickThumbs,
  plainCaption,
  plannerPlatform,
  postViewCount,
  postizProblem,
  previewOf,
  rangeFresh,
  rememberRange,
  statusOf,
  thumbDue,
  thumbExpiry,
  toListedColumns,
  toView,
  unknownIntegrations,
  viewsDue,
  youtubeId,
} from '../supabase/functions/_shared/postizRules'
import type * as Server from '../supabase/functions/_shared/postizRules'
import type * as Client from './sync/postizPosts'

// The server restates the client's contract (Deno cannot import src/). These
// fail to compile the day the two stop matching.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const viewMatches: Same<Server.PostizPostView, Client.PostizPostView> = true
const answerMatches: Same<Server.PostizPostsAnswer, Client.PostizPostsAnswer> = true
const rangeMatches: Same<Server.PostizRange, Client.PostizRange> = true

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const now = Date.parse('2026-11-24T18:00:00Z')

describe('the contract', () => {
  it('matches src/sync/postizPosts.ts', () => {
    expect([viewMatches, answerMatches, rangeMatches]).toEqual([true, true, true])
  })
})

describe('the range asked about', () => {
  it('takes two ISO times, from before to', () => {
    expect(checkRange('2026-11-22T05:00:00Z', '2026-11-29T05:00:00.000Z')).toEqual({
      from: '2026-11-22T05:00:00.000Z',
      to: '2026-11-29T05:00:00.000Z',
    })
    expect(checkRange('yesterday', '2026-11-29T05:00:00Z')).toBe('from and to must be ISO times.')
    expect(checkRange('2026-11-29T05:00:00Z', '2026-11-22T05:00:00Z')).toBe('to must be after from.')
    expect(checkRange(undefined, null)).toBe('from and to must be ISO times.')
  })

  it(`refuses more than ${MAX_RANGE_DAYS} days`, () => {
    expect(typeof checkRange('2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z')).toBe('string')
  })

  it('reads a list again only after 15 minutes, and a week read covers its days', () => {
    const week = { from: '2026-11-22T05:00:00.000Z', to: '2026-11-29T05:00:00.000Z' }
    const today = { from: '2026-11-24T05:00:00.000Z', to: '2026-11-25T05:00:00.000Z' }
    const ranges = rememberRange([], week, now)
    expect(rangeFresh(ranges, week, now + 14 * MINUTE)).toBe(true)
    expect(rangeFresh(ranges, today, now + 14 * MINUTE)).toBe(true)
    expect(rangeFresh(ranges, week, now + 15 * MINUTE)).toBe(false)
    expect(rangeFresh(rememberRange([], today, now), week, now)).toBe(false)
  })

  it('forgets ranges that are stale or covered by the new one', () => {
    const today = { from: '2026-11-24T05:00:00.000Z', to: '2026-11-25T05:00:00.000Z' }
    const week = { from: '2026-11-22T05:00:00.000Z', to: '2026-11-29T05:00:00.000Z' }
    const old = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-02T00:00:00.000Z', at: new Date(now - HOUR).toISOString() }
    const kept = rememberRange([old, ...rememberRange([], today, now)], week, now + MINUTE)
    expect(kept).toEqual([{ ...week, at: new Date(now + MINUTE).toISOString() }])
  })
})

describe("the hour's allowance", () => {
  const fresh: Allowance = { windowStart: null, used: 0, busyUntil: null }

  it(`gives up to ${PLANNER_POSTIZ_PER_HOUR} an hour, then waits for the next hour`, () => {
    const first = grant(fresh, 15, now)
    expect(first.granted).toBe(15)
    expect(first.next).toEqual({ windowStart: now, used: 15, busyUntil: null })
    const second = grant(first.next, 15, now + 10 * MINUTE)
    expect(second.granted).toBe(PLANNER_POSTIZ_PER_HOUR - 15)
    expect(second.waitUntil).toBe(now + HOUR)
    expect(grant(second.next, 1, now + 59 * MINUTE).granted).toBe(0)
    const later = grant(second.next, 3, now + HOUR)
    expect(later.granted).toBe(3)
    expect(later.next).toEqual({ windowStart: now + HOUR, used: 3, busyUntil: null })
  })

  it('asks nothing while Postiz has said too many', () => {
    const busy = afterTooMany({ windowStart: now, used: 4, busyUntil: null }, now + 50 * MINUTE)
    expect(busy.busyUntil).toBe(now + 65 * MINUTE)
    expect(grant(busy, 1, now + 64 * MINUTE)).toMatchObject({ granted: 0, waitUntil: now + 65 * MINUTE })
    expect(grant(busy, 1, now + 66 * MINUTE).granted).toBe(1)
    // Early in the hour: the hour is out first.
    expect(afterTooMany({ windowStart: now, used: 2, busyUntil: null }, now + MINUTE).busyUntil).toBe(now + HOUR)
  })

  it('never grants a negative or fractional number', () => {
    expect(grant({ windowStart: now, used: 30, busyUntil: null }, 5, now).granted).toBe(0)
    expect(grant(fresh, 2.7, now).granted).toBe(2)
    expect(grant(fresh, 0, now)).toMatchObject({ granted: 0, waitUntil: null })
  })

  it(`takes at most ${SHARED_POSTIZ_PER_HOUR} when the cutter posts with the same key, and none once it has used ${CUTTER_READ_SHARE}`, () => {
    const cutter = { since: now - 10 * MINUTE, used: 3, busyUntil: 0 }
    expect(grant(fresh, 15, now, cutter).granted).toBe(SHARED_POSTIZ_PER_HOUR)
    expect(grant(fresh, 15, now, { ...cutter, used: CUTTER_READ_SHARE })).toMatchObject({ granted: 0, waitUntil: now + 50 * MINUTE })
    // The cutter's hour is over: its count no longer holds the planner back.
    expect(grant(fresh, 15, now, { since: now - 2 * HOUR, used: 28, busyUntil: 0 }).granted).toBe(SHARED_POSTIZ_PER_HOUR)
    // The cutter waiting out a 429 means the planner waits too.
    expect(grant(fresh, 1, now, { ...cutter, busyUntil: now + 5 * MINUTE }).granted).toBe(0)
  })

  it("reads the cutter's count as it stores it", () => {
    expect(parseCutterUse(JSON.stringify({ since: 5, used: 7, busyUntil: 9 }))).toEqual({ since: 5, used: 7, busyUntil: 9 })
    expect(parseCutterUse('not json')).toBeNull()
    expect(parseCutterUse(null)).toBeNull()
  })

  it('fingerprints a key the way the cutter names its count', () => {
    expect(keyFingerprint(new Uint8Array([0, 1, 15, 16, 171, 205, 239, 255, 1, 2]))).toBe('00010f10abcdefff')
  })
})

describe("what Postiz's lists mean", () => {
  it('maps states to the planner words, and leaves drafts out', () => {
    expect(statusOf('QUEUE')).toBe('scheduled')
    expect(statusOf('PUBLISHED')).toBe('posted')
    expect(statusOf('error')).toBe('failed')
    expect(statusOf('DRAFT')).toBeNull()
    expect(statusOf(undefined)).toBeNull()
  })

  it("names platforms the planner's way", () => {
    expect(plannerPlatform('instagram-standalone')).toBe('Instagram')
    expect(plannerPlatform('instagram')).toBe('Instagram')
    expect(plannerPlatform('tiktok')).toBe('TikTok')
    expect(plannerPlatform('youtube')).toBe('YouTube')
    expect(plannerPlatform('facebook')).toBe('Facebook')
    expect(plannerPlatform('x')).toBe('X')
    expect(plannerPlatform('linkedin-page')).toBe('LinkedIn')
    expect(plannerPlatform('mastodon')).toBe('mastodon')
  })

  it('keeps handles without the @ and captions as text', () => {
    expect(cleanHandle(' @@ziad.moneytalks ')).toBe('ziad.moneytalks')
    expect(cleanHandle(undefined)).toBe('')
    expect(plainCaption('<p>POV: you &amp; me</p><p>link in bio<br>#ad-free</p>')).toBe('POV: you & me\nlink in bio\n#ad-free')
    expect(plainCaption(null)).toBe('')
  })

  it('reads accounts, skipping anything without an id', () => {
    expect(parseIntegrations([{ id: 'i1', name: 'Ziad', identifier: 'tiktok', profile: 'ziad', disabled: false }, { name: 'x' }, null])).toEqual([
      { id: 'i1', name: 'Ziad', identifier: 'tiktok', profile: 'ziad', disabled: false },
    ])
    expect(parseIntegrations({ error: 'no' })).toEqual([])
  })

  it('keeps one entry for a repeating post', () => {
    const list = parsePostList({ posts: [{ id: 'a', publishDate: '2026-11-22' }, { id: 'a', publishDate: '2026-11-23' }, { id: 'b' }, { nope: 1 }] })
    expect(list.map((p) => [p.id, p.publishDate])).toEqual([
      ['a', '2026-11-22'],
      ['b', undefined],
    ])
    expect(parsePostList(null)).toEqual([])
  })

  it("previews from the post's own media, else YouTube's thumbnail, else nothing", () => {
    expect(previewOf({ image: JSON.stringify([{ id: 'm', path: 'https://uploads.postiz.com/a.mp4' }]) })).toEqual({
      url: 'https://uploads.postiz.com/a.mp4',
      kind: 'video',
    })
    expect(previewOf({ image: [{ path: 'https://uploads.postiz.com/a.mp4', thumbnail: 'https://uploads.postiz.com/a.jpg' }] })).toEqual({
      url: 'https://uploads.postiz.com/a.jpg',
      kind: 'image',
    })
    expect(previewOf({ image: [{ path: 'https://uploads.postiz.com/b.png' }] })).toEqual({ url: 'https://uploads.postiz.com/b.png', kind: 'image' })
    expect(previewOf({ image: [{ path: '/relative/c.mp4' }], releaseURL: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })).toEqual({
      url: 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      kind: 'image',
    })
    expect(previewOf({ releaseURL: 'https://www.instagram.com/reel/Cx1/' })).toBeNull()
    expect(previewOf({ releaseURL: 'https://www.tiktok.com/@ziad/video/7300000000000000000' })).toBeNull()
    expect(previewOf({ image: 'not json' })).toBeNull()
  })

  it('finds the video id in every YouTube link shape', () => {
    expect(youtubeId('https://youtube.com/shorts/abcDEF12345')).toBe('abcDEF12345')
    expect(youtubeId('https://youtu.be/abcDEF12345?t=3')).toBe('abcDEF12345')
    expect(youtubeId('https://m.youtube.com/watch?v=abcDEF12345&feature=share')).toBe('abcDEF12345')
    expect(youtubeId('https://www.youtube.com/embed/abcDEF12345')).toBe('abcDEF12345')
    expect(youtubeId('https://www.youtube.com/channel/UC123')).toBeNull()
    expect(youtubeId('not a link')).toBeNull()
  })

  it('turns a listed post into cache columns, with the handle from the account list', () => {
    const integrations = parseIntegrations([{ id: 'i1', name: 'Ziad', identifier: 'instagram-standalone', profile: '@ziad.ugc' }])
    const post = {
      id: 'p1',
      group: 'g1',
      content: '<p>Hook one</p>',
      publishDate: '2026-11-23T14:00:00.000Z',
      releaseURL: 'https://www.instagram.com/reel/Cx1/',
      state: 'PUBLISHED',
      integration: { id: 'i1', providerIdentifier: 'instagram-standalone', name: 'Ziad' },
    }
    expect(toListedColumns(post, integrations)).toEqual({
      post_id: 'p1',
      post_group: 'g1',
      integration_id: 'i1',
      platform: 'Instagram',
      handle: 'ziad.ugc',
      release_url: 'https://www.instagram.com/reel/Cx1/',
      preview_url: null,
      preview_kind: null,
      caption: 'Hook one',
      published_at: '2026-11-23T14:00:00.000Z',
      status: 'posted',
    })
    expect(toListedColumns({ ...post, state: 'DRAFT' }, integrations)).toBeNull()
    expect(toListedColumns({ ...post, group: '' }, integrations)?.post_group).toBeNull()
    // An account the list does not have yet: no handle is guessed.
    expect(toListedColumns({ ...post, integration: { id: 'i9', providerIdentifier: 'tiktok' } }, integrations)).toMatchObject({
      platform: 'TikTok',
      handle: '',
    })
    expect(unknownIntegrations([post, { id: 'p2', integration: { id: 'i9' } }], integrations)).toEqual(['i9'])
  })
})

function cached(overrides: Partial<CachedPost>): CachedPost {
  return {
    post_id: 'p',
    post_group: null,
    integration_id: 'i1',
    platform: 'TikTok',
    handle: 'ziad',
    release_url: null,
    preview_url: null,
    preview_kind: null,
    caption: '',
    published_at: new Date(now - 2 * DAY).toISOString(),
    status: 'posted',
    views: null,
    views_at: null,
    views_checked_at: null,
    thumb_url: null,
    thumb_at: null,
    ...overrides,
  }
}

describe('when a video is due a views reading', () => {
  const out = (hoursAgo: number) => new Date(now - hoursAgo * HOUR).toISOString()

  it('first an hour after it went out, at any age', () => {
    expect(viewsDue(cached({ published_at: out(0.5) }), now)).toBe(false)
    expect(viewsDue(cached({ published_at: out(1) }), now)).toBe(true)
    expect(viewsDue(cached({ published_at: out(24 * 20) }), now)).toBe(true)
  })

  it('then a day, three days and a week after, once each, until eight days', () => {
    const at = now - 200 * HOUR
    const post = (checkedHoursAfter: number) =>
      cached({ published_at: new Date(at).toISOString(), views_checked_at: new Date(at + checkedHoursAfter * HOUR).toISOString() })
    expect(viewsDue(post(2), at + 23 * HOUR)).toBe(false)
    expect(viewsDue(post(2), at + 25 * HOUR)).toBe(true)
    expect(viewsDue(post(25), at + 30 * HOUR)).toBe(false)
    expect(viewsDue(post(25), at + 73 * HOUR)).toBe(true)
    expect(viewsDue(post(73), at + 169 * HOUR)).toBe(true)
    expect(viewsDue(post(169), at + 190 * HOUR)).toBe(false)
    expect(viewsDue(post(73), at + 9 * 24 * HOUR)).toBe(false)
  })

  it('never for a post that is scheduled, failed or not out yet', () => {
    expect(viewsDue(cached({ status: 'scheduled' }), now)).toBe(false)
    expect(viewsDue(cached({ status: 'failed' }), now)).toBe(false)
    expect(viewsDue(cached({ published_at: new Date(now + HOUR).toISOString() }), now)).toBe(false)
    expect(viewsDue(cached({ published_at: null }), now)).toBe(false)
  })

  it('reads never-read videos first, newest first, then the longest since asked', () => {
    const posts = [
      cached({ post_id: 'again-old', views_checked_at: out(100), published_at: out(150) }),
      cached({ post_id: 'never-old', published_at: out(48) }),
      cached({ post_id: 'never-new', published_at: out(3) }),
      cached({ post_id: 'again-new', views_checked_at: out(90), published_at: out(160) }),
      cached({ post_id: 'scheduled', status: 'scheduled', published_at: out(-5) }),
    ]
    expect(pickDue(posts, now, 10).map((p) => p.post_id)).toEqual(['never-new', 'never-old', 'again-old', 'again-new'])
    expect(pickDue(posts, now, 2).map((p) => p.post_id)).toEqual(['never-new', 'never-old'])
  })

  it('counts as still reading only a posted video with no number that will be asked again', () => {
    expect(awaitingViews(cached({}), now)).toBe(true)
    expect(awaitingViews(cached({ views: 10, views_at: out(1) }), now)).toBe(false)
    expect(awaitingViews(cached({ status: 'scheduled' }), now)).toBe(false)
    expect(awaitingViews(cached({ published_at: out(24 * 10), views_checked_at: out(24 * 2) }), now)).toBe(false)
    expect(awaitingViews(cached({ published_at: out(24 * 10) }), now)).toBe(true)
  })
})

describe('TikTok thumbnails', () => {
  const video = 'https://www.tiktok.com/@ziad.ugc/video/7300000000000000001'
  const tiktok = (overrides: Partial<CachedPost>) => cached({ release_url: video, ...overrides })
  const ago = (hours: number) => new Date(now - hours * HOUR).toISOString()

  it('asks oEmbed only about TikTok video links', () => {
    expect(isTikTokVideo(video)).toBe(true)
    expect(isTikTokVideo('https://tiktok.com/@ziad/video/1')).toBe(true)
    expect(isTikTokVideo('https://www.tiktok.com/@ziad')).toBe(false)
    expect(isTikTokVideo('https://www.instagram.com/reel/Cx1/')).toBe(false)
    expect(isTikTokVideo('https://evil-tiktok.com/@a/video/1')).toBe(false)
    expect(isTikTokVideo('http://www.tiktok.com/@a/video/1')).toBe(false)
    expect(oembedUrl(video)).toBe('https://www.tiktok.com/oembed?url=https%3A%2F%2Fwww.tiktok.com%2F%40ziad.ugc%2Fvideo%2F7300000000000000001')
  })

  it('takes thumbnail_url from the answer', () => {
    expect(oembedThumbnail({ title: 't', thumbnail_url: 'https://p16-sign.tiktokcdn-us.com/x.jpeg?x-expires=1' })).toBe(
      'https://p16-sign.tiktokcdn-us.com/x.jpeg?x-expires=1',
    )
    expect(oembedThumbnail({ thumbnail_url: 'javascript:1' })).toBeNull()
    expect(oembedThumbnail(null)).toBeNull()
  })

  it('asks for posted TikTok videos never asked, after a day, after six hours when there was none, or as the link expires', () => {
    expect(thumbDue(tiktok({}), now)).toBe(true)
    expect(thumbDue(tiktok({ status: 'scheduled' }), now)).toBe(false)
    expect(thumbDue(cached({ release_url: 'https://www.instagram.com/reel/Cx1/' }), now)).toBe(false)
    expect(thumbDue(tiktok({ thumb_url: 'https://cdn/x.jpg', thumb_at: ago(23) }), now)).toBe(false)
    expect(thumbDue(tiktok({ thumb_url: 'https://cdn/x.jpg', thumb_at: ago(24) }), now)).toBe(true)
    expect(thumbDue(tiktok({ thumb_url: null, thumb_at: ago(5) }), now)).toBe(false)
    expect(thumbDue(tiktok({ thumb_url: null, thumb_at: ago(6) }), now)).toBe(true)
    const expiring = `https://cdn/x.jpg?x-expires=${(now + 30 * MINUTE) / 1000}&x-signature=abc`
    expect(thumbExpiry(expiring)).toBe(now + 30 * MINUTE)
    expect(thumbDue(tiktok({ thumb_url: expiring, thumb_at: ago(1) }), now)).toBe(true)
  })

  it('picks at most the cap, newest video first', () => {
    const posts = [tiktok({ post_id: 'old', published_at: ago(48) }), tiktok({ post_id: 'new', published_at: ago(2) }), cached({ post_id: 'ig' })]
    expect(pickThumbs(posts, now, 10).map((p) => p.post_id)).toEqual(['new', 'old'])
    expect(pickThumbs(posts, now, 1).map((p) => p.post_id)).toEqual(['new'])
  })

  it("shows the post's own preview first, else the thumbnail while its link works", () => {
    const thumb = `https://cdn/x.jpg?x-expires=${(now + HOUR) / 1000}`
    expect(toView(tiktok({ thumb_url: thumb, thumb_at: ago(1) }), now)).toMatchObject({ preview: thumb, previewKind: 'image' })
    expect(toView(tiktok({ thumb_url: thumb, thumb_at: ago(1) }), now + 2 * HOUR)).toMatchObject({ preview: null, previewKind: null })
    expect(toView(tiktok({ preview_url: 'https://img.youtube.com/vi/a/hqdefault.jpg', preview_kind: 'image', thumb_url: thumb }), now).preview).toBe(
      'https://img.youtube.com/vi/a/hqdefault.jpg',
    )
    expect(toView(cached({ post_group: 'g1' }), now).group).toBe('g1')
  })
})

describe("reading Postiz's answer for one post (ported from the cutter)", () => {
  it('takes the views metric, a running total by its last day', () => {
    expect(
      postViewCount([
        { label: 'Likes', data: [{ total: 40, date: '2026-10-11' }] },
        { label: 'Views', data: [{ total: '900', date: '2026-10-11' }, { total: '1400', date: '2026-10-12' }] },
      ]),
    ).toBe(1400)
  })

  it('adds a day-by-day series up, and falls back to impressions', () => {
    expect(postViewCount([{ label: 'Views', data: [{ total: 800, date: '2026-10-11' }, { total: 300, date: '2026-10-12' }] }])).toBe(1100)
    expect(postViewCount([{ label: 'Impressions', data: [{ total: 5000, date: '2026-10-12' }] }])).toBe(5000)
  })

  it('reads an object with a views number, and says nothing for nothing', () => {
    expect(postViewCount({ views: 1234, likes: 5 })).toBe(1234)
    expect(postViewCount([])).toBeNull()
    expect(postViewCount({ missing: true })).toBeNull()
    expect(postViewCount(null)).toBeNull()
  })
})

describe('the answer', () => {
  const range = { from: '2026-11-22T05:00:00.000Z', to: '2026-11-29T05:00:00.000Z' }

  it('is the posts in [from, to), newest first, with views only when read', () => {
    const rows = [
      cached({ post_id: 'before', published_at: '2026-11-22T04:59:59.000Z' }),
      cached({ post_id: 'first', published_at: '2026-11-22T05:00:00+00:00', views: 120, views_at: '2026-11-23T05:00:00+00:00', views_checked_at: '2026-11-23T05:00:00+00:00' }),
      cached({ post_id: 'tomorrow', status: 'scheduled', published_at: '2026-11-25T15:00:00+00:00' }),
      cached({ post_id: 'unread', published_at: '2026-11-24T10:00:00+00:00', preview_kind: 'image' }),
      cached({ post_id: 'end', published_at: '2026-11-29T05:00:00.000Z' }),
    ]
    const answer = answerFrom(rows, range, now)
    expect(answer.connected).toBe(true)
    expect(answer.posts.map((p) => p.id)).toEqual(['tomorrow', 'unread', 'first'])
    expect(answer.reading).toBe(1)
    expect(answer.error).toBeUndefined()
    expect(answer.posts[2]).toMatchObject({ views: 120, viewsAt: '2026-11-23T05:00:00.000Z', status: 'posted', publishedAt: '2026-11-22T05:00:00.000Z' })
    expect(answer.posts[1]).toMatchObject({ views: null, viewsAt: null, preview: null, previewKind: null })
    expect(answer.posts[0].status).toBe('scheduled')
  })

  it('carries why Postiz could not be read, with what was read before', () => {
    expect(answerFrom([cached({ published_at: '2026-11-23T05:00:00Z' })], range, now, 'Postiz had a problem (502).')).toMatchObject({
      posts: [{ id: 'p' }],
      error: 'Postiz had a problem (502).',
    })
  })

  it('says what went wrong in plain words', () => {
    expect(postizProblem(401, 'Invalid API key')).toMatch(/didn't accept your saved key/)
    expect(postizProblem(401, 'No subscription found')).toMatch(/no subscription/)
    expect(postizProblem(429, null)).toMatch(/too many requests/)
    expect(postizProblem(503, null)).toMatch(/Postiz had a problem \(503\)/)
  })
})
