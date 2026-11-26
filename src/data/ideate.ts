// The IDEATE screen's arithmetic: every video that went out over a period,
// which campaign it belongs to, and what it did - overall, per campaign, per
// platform, per account and per day.
//
// Pure functions over rows already loaded, so IDEATE and the coach view read
// one definition. Nothing here writes, and nothing here makes a number up:
//
//   - videos are the posts that went out (src/sync/postizPosts.ts) - from the
//     cutter's own records for a key the cutter posts with, else from
//     Postiz - placed on a campaign by homeOfPost (src/data/postHome.ts), the
//     same rule TODAY's "Going out" uses. A cutter campaign the planner has no
//     campaign for keeps its own name, so none of his videos goes missing;
//   - views are the readings that came back. A video whose views have not
//     been read is unknown: it counts as a video that went out, and is left
//     out of every total, average, median, best, worst and hit rate - never
//     counted as zero.

import { byBestPay } from '../money'
import type { PostizPostView } from '../sync/postizPosts'
import { byRecordingPriority } from './campaignOrder'
import { localToday } from './index'
import { homeKey, homeOfPost, type PostHome } from './postHome'
import type { Campaign, CampaignAccount } from './schema'

// --- Days and weeks ------------------------------------------------------------

function utc(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** A calendar day `days` after `date` (before, when negative). Date-string
 *  arithmetic only, so no clock or time zone can move a day. */
export function addDays(date: string, days: number): string {
  const day = utc(date)
  day.setUTCDate(day.getUTCDate() + days)
  return day.toISOString().slice(0, 10)
}

/** The Sunday that starts the week holding `date` - what ideate_notes files a
 *  note under. */
export function sundayOf(date: string): string {
  return addDays(date, -utc(date).getUTCDay())
}

/** The Saturday that ends it. */
export function weekEndOf(weekStart: string): string {
  return addDays(weekStart, 6)
}

/** An ISO instant as milliseconds, whatever its spelling - the server writes
 *  microseconds and "+00:00", which not every browser's Date reads. NaN for
 *  anything that is not one. */
export function instant(iso: string): number {
  return Date.parse(iso.trim().replace(/(\.\d{3})\d+/, '$1'))
}

/** The local calendar day an instant fell on. */
export function localDay(iso: string): string {
  return localToday(new Date(instant(iso)))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "Tue, Nov 24" */
export function dayLabel(date: string): string {
  const day = utc(date)
  return `${DAYS[day.getUTCDay()]}, ${MONTHS[day.getUTCMonth()]} ${day.getUTCDate()}`
}

/** "Nov 24" */
export function shortDay(date: string): string {
  const day = utc(date)
  return `${MONTHS[day.getUTCMonth()]} ${day.getUTCDate()}`
}

/** "Nov 22 – 28", "Nov 29 – Dec 5", and the year where it is not this one:
 *  "Nov 2 – 8, 2025", "Dec 28, 2025 – Jan 3". */
export function weekRange(weekStart: string, today: string = localToday()): string {
  return dayRange(weekStart, weekEndOf(weekStart), today)
}

/** Any run of days, written like weekRange. */
export function dayRange(first: string, last: string, today: string = localToday()): string {
  const a = utc(first)
  const b = utc(last)
  const thisYear = utc(today).getUTCFullYear()
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear()
  const startYear = !sameYear && a.getUTCFullYear() !== thisYear ? `, ${a.getUTCFullYear()}` : ''
  const endYear = b.getUTCFullYear() !== thisYear ? `, ${b.getUTCFullYear()}` : ''
  const start = `${MONTHS[a.getUTCMonth()]} ${a.getUTCDate()}${startYear}`
  const end =
    a.getUTCMonth() === b.getUTCMonth() && sameYear ? `${b.getUTCDate()}` : `${MONTHS[b.getUTCMonth()]} ${b.getUTCDate()}`
  return `${start} – ${end}${endYear}`
}

/** "This week", "Last week", or the range for any other. */
export function weekName(weekStart: string, today: string = localToday()): string {
  const current = sundayOf(today)
  if (weekStart === current) return 'This week'
  if (weekStart === addDays(current, -7)) return 'Last week'
  return weekRange(weekStart, today)
}

// --- The period shown ------------------------------------------------------------

export type IdeatePeriod = 'week' | 'last-week' | '30-days'

export const IDEATE_PERIODS: readonly { id: IdeatePeriod; label: string }[] = [
  { id: 'week', label: 'This week' },
  { id: 'last-week', label: 'Last week' },
  { id: '30-days', label: '30 days' },
]

export interface PeriodRange {
  /** Local midnight that opens it, as an ISO instant (inclusive). */
  from: string
  /** Local midnight that closes it (exclusive). */
  to: string
  /** The Sunday a note written while looking at it is filed under. */
  weekStart: string
}

function midnight(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toISOString()
}

/** The first day of a period and how many days it runs. */
function periodSpan(period: IdeatePeriod, now: Date): { first: string; length: number } {
  const today = localToday(now)
  const sunday = sundayOf(today)
  if (period === 'last-week') return { first: addDays(sunday, -7), length: 7 }
  if (period === '30-days') return { first: addDays(today, -29), length: 30 }
  return { first: sunday, length: 7 }
}

/** The instants a period covers. Weeks run Sunday to Saturday, the way the
 *  week calendar reads; "30 days" is today and the 29 before it. */
export function periodRange(period: IdeatePeriod, now: Date = new Date()): PeriodRange {
  const { first, length } = periodSpan(period, now)
  const weekStart = period === 'last-week' ? first : sundayOf(localToday(now))
  return { from: midnight(first), to: midnight(addDays(first, length)), weekStart }
}

/** Every calendar day of a period, first to last - including the ones still
 *  to come this week, which simply have nothing yet. */
export function periodDays(period: IdeatePeriod, now: Date = new Date()): string[] {
  const { first, length } = periodSpan(period, now)
  return Array.from({ length }, (_, i) => addDays(first, i))
}

// --- Campaigns -------------------------------------------------------------------

/** The campaigns in the Campaigns list's order, so the screens agree: the
 *  high-quality ones (a minimum views) first, then the quick ones, each best
 *  pay first (src/data/campaignOrder.ts). Archived ones are left out. */
export function campaignsInOrder<T extends Campaign>(campaigns: readonly T[], accounts: readonly CampaignAccount[]): T[] {
  return byRecordingPriority(byBestPay(campaigns.filter((c) => c.is_active !== false), accounts))
}

/** True when the campaign has at least one switched-on account with a handle -
 *  without one, a Postiz post can never be told to be the campaign's. */
export function hasHandles(accounts: readonly CampaignAccount[], campaignId: string): boolean {
  return accounts.some((a) => a.campaign_id === campaignId && a.is_active && (a.handle ?? '').trim().replace(/^@+/, '') !== '')
}

// --- Videos -----------------------------------------------------------------------

/** One post that went out: a video on one account. */
export interface IdeatePost {
  post: PostizPostView
  /** The planner account it went out on, when one matched exactly - a post
   *  in a campaign linked to the cutter can be on an account the planner
   *  does not list. */
  accountId: string | null
}

/** One video - one deliverable - however many accounts it went out on
 *  (CLAUDE.md, "A video is one deliverable, posted to every account"). Its
 *  posts share a group; a post with no group is a video of its own. */
export interface IdeateVideo {
  /** The group, or the post's id. */
  id: string
  /** Which campaign it is: one of the planner's, a cutter campaign the
   *  planner has no campaign for, or none. */
  home: PostHome
  /** homeKey(home): the planner campaign's id, `cutter:<id>`, or 'none'. */
  homeKey: string
  /** Where it went out, one post per account: Instagram first, then the rest
   *  by platform name. */
  posts: IdeatePost[]
  /** When it first went out. */
  publishedAt: string | null
  /** The local day it first went out. */
  day: string | null
  /** Its views on every account whose views have been read, added up; null
   *  while none has. */
  views: number | null
  /** How many of its posts are still waiting for their views. */
  unread: number
  /** Whichever of its posts has a preview - the cutter gives the video file
   *  itself; Postiz gives TikTok and YouTube a picture and Instagram none. */
  preview: { src: string; kind: 'image' | 'video' } | null
  /** The post a tap opens: the Instagram one when there is one, else the
   *  first with a link. */
  primary: IdeatePost
  caption: string
}

const isHttp = (url: string | null): url is string => url !== null && /^https?:\/\//i.test(url)
const isInstagram = (platform: string) => platform.trim().toLowerCase().startsWith('instagram')
const viewsOf = (post: PostizPostView) => (typeof post.views === 'number' && Number.isFinite(post.views) ? post.views : null)
const timeOf = (iso: string | null) => {
  const at = iso ? instant(iso) : NaN
  return Number.isFinite(at) ? at : -Infinity
}

/** The video's campaign: the planner campaign most of its posts land on
 *  (Instagram's first when tied), else the cutter campaign, else none. One
 *  video is one deliverable, so it is never split across two. */
function videoHome(homes: readonly PostHome[]): PostHome {
  const counts = new Map<string, number>()
  for (const home of homes) if (home.kind === 'campaign') counts.set(home.campaignId, (counts.get(home.campaignId) ?? 0) + 1)
  let pick: string | null = null
  for (const [campaignId, count] of counts) if (pick === null || count > (counts.get(pick) ?? 0)) pick = campaignId
  if (pick !== null) return { kind: 'campaign', campaignId: pick, accountId: null }
  return homes.find((h) => h.kind === 'cutter') ?? { kind: 'none' }
}

/** Every video that went out, newest first, each placed on its campaign.
 *  Scheduled, waiting and failed posts did not go out and are left out. */
export function ideateVideos(
  posts: readonly PostizPostView[],
  campaigns: readonly Pick<Campaign, 'id' | 'name' | 'is_active' | 'cutter_campaign_id'>[],
  accounts: readonly Pick<CampaignAccount, 'id' | 'campaign_id' | 'platform' | 'handle' | 'is_active'>[],
): IdeateVideo[] {
  // A month is a couple of thousand posts on a few dozen accounts: place each
  // account once.
  const placed = new Map<string, PostHome>()
  const homeFor = (post: PostizPostView) => {
    const key = [post.platform, post.handle, post.campaign?.id ?? '', post.campaign?.name ?? ''].join('\u0000')
    let home = placed.get(key)
    if (!home) {
      home = homeOfPost(post, campaigns, accounts)
      placed.set(key, home)
    }
    return home
  }

  const groups = new Map<string, PostizPostView[]>()
  for (const post of posts) {
    if (post.status !== 'posted') continue
    const key = post.group ?? `post:${post.id}`
    const list = groups.get(key)
    if (list) list.push(post)
    else groups.set(key, [post])
  }

  const videos = [...groups.entries()].map(([key, list]): IdeateVideo => {
    const sorted = [...list].sort(
      (a, b) =>
        Number(isInstagram(b.platform)) - Number(isInstagram(a.platform)) ||
        a.platform.localeCompare(b.platform) ||
        a.id.localeCompare(b.id),
    )
    const homes = sorted.map(homeFor)
    const home = videoHome(homes)
    const items: IdeatePost[] = sorted.map((post, i) => {
      const own = homes[i]
      return {
        post,
        accountId: home.kind === 'campaign' && own.kind === 'campaign' && own.campaignId === home.campaignId ? own.accountId : null,
      }
    })
    const read = sorted.map(viewsOf).filter((v): v is number => v !== null)
    const first = [...sorted].sort((a, b) => timeOf(a.publishedAt) - timeOf(b.publishedAt))[0]
    const withPreview = sorted.find((p) => isHttp(p.preview))
    const primary =
      items.find((p) => isInstagram(p.post.platform) && isHttp(p.post.url)) ?? items.find((p) => isHttp(p.post.url)) ?? items[0]
    return {
      id: key.startsWith('post:') ? key.slice(5) : key,
      home,
      homeKey: homeKey(home),
      posts: items,
      publishedAt: first.publishedAt,
      day: first.publishedAt && Number.isFinite(instant(first.publishedAt)) ? localDay(first.publishedAt) : null,
      views: read.length === 0 ? null : read.reduce((sum, v) => sum + v, 0),
      unread: sorted.length - read.length,
      preview: withPreview
        ? { src: withPreview.preview as string, kind: withPreview.previewKind === 'video' ? 'video' : 'image' }
        : null,
      primary,
      caption: sorted.find((p) => p.caption.trim() !== '')?.caption ?? '',
    }
  })
  return videos.sort((a, b) => timeOf(b.publishedAt) - timeOf(a.publishedAt) || a.id.localeCompare(b.id))
}

/** One campaign's videos (or every video, for 'all'). */
export function videosIn(videos: readonly IdeateVideo[], key: string): IdeateVideo[] {
  return key === ALL ? [...videos] : videos.filter((v) => v.homeKey === key)
}

// --- The figures ------------------------------------------------------------------

/** The thresholds a video is counted as a hit at. */
export const HIT_THRESHOLDS = [1_000, 10_000] as const

export interface HitRate {
  /** Read videos at or over the threshold. */
  hits: number
  /** Read videos. */
  of: number
  /** hits / of, 0 to 1. */
  share: number
}

export interface VideoStats {
  /** Videos that went out - one however many platforms, read or not. */
  posted: number
  /** How many of them have any views read. */
  read: number
  /** Of the read ones only; null when none has been read. */
  total: number | null
  average: number | null
  median: number | null
  best: IdeateVideo | null
  /** Null until two have been read - one video is not both. */
  worst: IdeateVideo | null
  /** Share of read videos with 1,000 views or more, then 10,000 or more. */
  over1k: HitRate | null
  over10k: HitRate | null
}

/** The read videos, most views first; between equals, the newer one. */
export function rankedByViews(videos: readonly IdeateVideo[]): IdeateVideo[] {
  return videos
    .filter((v) => v.views !== null)
    .sort((a, b) => (b.views as number) - (a.views as number) || timeOf(b.publishedAt) - timeOf(a.publishedAt) || a.id.localeCompare(b.id))
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

function hitRate(values: readonly number[], threshold: number): HitRate | null {
  if (values.length === 0) return null
  const hits = values.filter((v) => v >= threshold).length
  return { hits, of: values.length, share: hits / values.length }
}

/** The figures for a set of videos, per video. Only read views count: a
 *  video still waiting for its views is in `posted` and nowhere else. */
export function videoStats(videos: readonly IdeateVideo[]): VideoStats {
  const ranked = rankedByViews(videos)
  const values = ranked.map((v) => v.views as number)
  const total = values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0)
  return {
    posted: videos.length,
    read: values.length,
    total,
    average: total === null ? null : Math.round(total / values.length),
    median: median(values),
    best: ranked[0] ?? null,
    worst: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    over1k: hitRate(values, HIT_THRESHOLDS[0]),
    over10k: hitRate(values, HIT_THRESHOLDS[1]),
  }
}

/** What's working: the best (up to three) and the weakest (up to three,
 *  worst first), never the same video in both. With two read, one of each;
 *  with one, it is only the best. */
export function standouts(videos: readonly IdeateVideo[], most = 3): { best: IdeateVideo[]; weakest: IdeateVideo[] } {
  const ranked = rankedByViews(videos)
  const best = ranked.slice(0, Math.min(most, Math.max(1, ranked.length - 1)))
  const rest = ranked.slice(best.length)
  return { best, weakest: rest.slice(-most).reverse() }
}

/** How many of these videos are still waiting for views on some platform -
 *  only while the server says it is still reading. A video Postiz will never
 *  read is not "coming in". */
export function viewsComingIn(videos: readonly IdeateVideo[], reading: number): number {
  if (reading <= 0) return 0
  return videos.filter((v) => v.unread > 0).length
}

// --- Breakdowns -------------------------------------------------------------------

/** The overall view's key in the campaign picker. */
export const ALL = 'all'
/** Posts on accounts no campaign lists. */
export const NO_HOME = 'none'
export const NO_HOME_NAME = 'Other accounts'

export interface HomeOption {
  /** ALL, a planner campaign's id, `cutter:<id>`, or NO_HOME. */
  key: string
  name: string
  kind: 'all' | 'campaign' | 'cutter' | 'none'
  /** The planner campaign, when it is one - notes need it. */
  campaignId: string | null
  /** Videos in the period; null while they are not known. */
  count: number | null
}

/** The campaign picker: everything first, then every planner campaign in
 *  the order given (empty ones too - they are dimmed, not hidden), then the
 *  cutter campaigns the planner has no campaign for, most videos first, then
 *  posts no campaign lists. `keep` holds an option already chosen, so it
 *  stays put while another period loads or when it has none in this one. */
export function homeOptions(
  campaigns: readonly Pick<Campaign, 'id' | 'name'>[],
  videos: readonly IdeateVideo[] | null,
  keep: readonly { key: string; name: string }[] = [],
): HomeOption[] {
  const counts = new Map<string, number>()
  const cutter = new Map<string, string>()
  for (const v of videos ?? []) {
    counts.set(v.homeKey, (counts.get(v.homeKey) ?? 0) + 1)
    if (v.home.kind === 'cutter') cutter.set(v.homeKey, v.home.name)
  }
  const count = (key: string) => (videos === null ? null : (counts.get(key) ?? 0))

  const options: HomeOption[] = [
    { key: ALL, name: 'All campaigns', kind: 'all', campaignId: null, count: videos === null ? null : videos.length },
    ...campaigns.map((c): HomeOption => ({ key: c.id, name: c.name, kind: 'campaign', campaignId: c.id, count: count(c.id) })),
    ...[...cutter.entries()]
      .map(([key, name]): HomeOption => ({ key, name, kind: 'cutter', campaignId: null, count: count(key) }))
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.name.localeCompare(b.name)),
  ]
  if ((counts.get(NO_HOME) ?? 0) > 0) options.push({ key: NO_HOME, name: NO_HOME_NAME, kind: 'none', campaignId: null, count: count(NO_HOME) })
  for (const kept of keep) {
    if (options.some((o) => o.key === kept.key)) continue
    if (kept.key === NO_HOME) options.push({ key: NO_HOME, name: NO_HOME_NAME, kind: 'none', campaignId: null, count: count(NO_HOME) })
    else if (kept.key.startsWith('cutter:')) options.push({ key: kept.key, name: kept.name, kind: 'cutter', campaignId: null, count: count(kept.key) })
  }
  return options
}

export interface CampaignRow {
  key: string
  name: string
  videos: number
  read: number
  total: number | null
  average: number | null
  best: number | null
}

/** Per campaign, every one that had a video in the period: most views
 *  first, then most videos. Names come from the picker's options, so a
 *  cutter campaign reads the same in both. */
export function byCampaign(videos: readonly IdeateVideo[], options: readonly Pick<HomeOption, 'key' | 'name'>[]): CampaignRow[] {
  const groups = new Map<string, IdeateVideo[]>()
  for (const v of videos) {
    const list = groups.get(v.homeKey)
    if (list) list.push(v)
    else groups.set(v.homeKey, [v])
  }
  const nameOf = (key: string, list: IdeateVideo[]) =>
    options.find((o) => o.key === key)?.name ??
    (list[0].home.kind === 'cutter' ? list[0].home.name : key === NO_HOME ? NO_HOME_NAME : key)
  return [...groups.entries()]
    .map(([key, list]): CampaignRow => {
      const stats = videoStats(list)
      return {
        key,
        name: nameOf(key, list),
        videos: list.length,
        read: stats.read,
        total: stats.total,
        average: stats.average,
        best: stats.best?.views ?? null,
      }
    })
    .sort(
      (a, b) =>
        Number(a.key === NO_HOME) - Number(b.key === NO_HOME) ||
        (b.total ?? -1) - (a.total ?? -1) ||
        b.videos - a.videos ||
        a.name.localeCompare(b.name),
    )
}

export interface PlatformRow {
  platform: string
  /** Posts on it - one per account a video went to. */
  posts: number
  read: number
  /** Of its read posts. */
  views: number | null
  /** Per read post. */
  average: number | null
}

/** Per platform, counted per post: a video on Instagram and TikTok is one
 *  post on each. Most views first. */
export function byPlatform(videos: readonly IdeateVideo[]): PlatformRow[] {
  const rows = new Map<string, { platform: string; posts: number; values: number[] }>()
  for (const v of videos) {
    for (const { post } of v.posts) {
      const name = post.platform.trim() || 'Other'
      const key = name.toLowerCase()
      const row = rows.get(key) ?? { platform: name, posts: 0, values: [] }
      row.posts += 1
      const views = viewsOf(post)
      if (views !== null) row.values.push(views)
      rows.set(key, row)
    }
  }
  return [...rows.values()]
    .map((row): PlatformRow => {
      const total = row.values.length === 0 ? null : row.values.reduce((s, v) => s + v, 0)
      return {
        platform: row.platform,
        posts: row.posts,
        read: row.values.length,
        views: total,
        average: total === null ? null : Math.round(total / row.values.length),
      }
    })
    .sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || b.posts - a.posts || a.platform.localeCompare(b.platform))
}

export interface AccountRow {
  key: string
  platform: string
  /** Without the @. */
  handle: string
  accountId: string | null
  posts: number
  read: number
  average: number | null
  best: number | null
}

const handleOf = (handle: string) => handle.trim().replace(/^@+/, '')

/** Per account, counted per post: best average first, then most posts. */
export function byAccount(videos: readonly IdeateVideo[]): AccountRow[] {
  const rows = new Map<string, { platform: string; handle: string; accountId: string | null; posts: number; values: number[] }>()
  for (const v of videos) {
    for (const { post, accountId } of v.posts) {
      const handle = handleOf(post.handle)
      const key = accountId ?? `${post.platform.trim().toLowerCase()}|${handle.toLowerCase()}`
      const row = rows.get(key) ?? { platform: post.platform, handle, accountId, posts: 0, values: [] }
      row.posts += 1
      const views = viewsOf(post)
      if (views !== null) row.values.push(views)
      rows.set(key, row)
    }
  }
  return [...rows.entries()]
    .map(([key, row]): AccountRow => ({
      key,
      platform: row.platform,
      handle: row.handle,
      accountId: row.accountId,
      posts: row.posts,
      read: row.values.length,
      average: row.values.length === 0 ? null : Math.round(row.values.reduce((s, v) => s + v, 0) / row.values.length),
      best: row.values.length === 0 ? null : Math.max(...row.values),
    }))
    .sort((a, b) => (b.average ?? -1) - (a.average ?? -1) || b.posts - a.posts || a.handle.localeCompare(b.handle))
}

export interface DayRow {
  day: string
  /** Videos that first went out that day. */
  videos: number
  read: number
  /** Per read video; null when none of the day's has been read. */
  average: number | null
}

/** Per day of the period, every day in order - an empty day is a day with
 *  nothing out, not a gap. */
export function byDay(videos: readonly IdeateVideo[], days: readonly string[]): DayRow[] {
  const buckets = new Map<string, IdeateVideo[]>(days.map((d) => [d, []]))
  for (const v of videos) if (v.day !== null) buckets.get(v.day)?.push(v)
  return days.map((day) => {
    const list = buckets.get(day) ?? []
    const stats = videoStats(list)
    return { day, videos: list.length, read: stats.read, average: stats.average }
  })
}

// --- Numbers as he reads them -------------------------------------------------------

/** "850", "1.2K", "12.4K", "124K", "1.2M" - views the way the platforms
 *  write them. */
export function compactViews(views: number): string {
  const n = Math.max(0, Math.round(views))
  if (n < 1000) return String(n)
  const unit = (value: number, suffix: string) => {
    const shown = value < 100 ? Number(value.toFixed(1)) : Math.round(value)
    return `${shown}${suffix}`
  }
  // 999,500 rounds to a thousand K: that is "1M".
  if (n < 999_500) return unit(n / 1000, 'K')
  return unit(n / 1_000_000, 'M')
}

/** A headline figure: exact under ten thousand ("2,000"), compact above it
 *  ("48.2K"), so it fits a phone's half width. */
export function headlineViews(views: number): string {
  return views < 10_000 ? Math.round(views).toLocaleString('en-US') : compactViews(views)
}

/** "34%" */
export function percent(share: number): string {
  return `${Math.round(share * 100)}%`
}
