// The IDEATE screen's arithmetic: one campaign's videos over a period, and
// what they did.
//
// Pure functions over rows already loaded, so IDEATE and the coach view read
// one definition. Nothing here writes, and nothing here makes a number up:
//
//   - videos are the student's own Postiz posts (src/sync/postizPosts.ts),
//     the ones that actually went out, matched to the campaign by platform
//     and exact handle - mineFor, the same rule Analytics uses;
//   - views are Postiz's readings. A video whose views have not been read is
//     shown as unknown and left out of the average, the best and the worst -
//     never counted as zero.

import { byBestPay } from '../money'
import type { PostizPostView } from '../sync/postizPosts'
import { byRecordingPriority } from './campaignOrder'
import { mineFor, type MyAccount } from './campaignViews'
import { localToday } from './index'
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

/** "Nov 22 – 28", "Nov 29 – Dec 5", and the year where it is not this one:
 *  "Nov 2 – 8, 2025", "Dec 28, 2025 – Jan 3". */
export function weekRange(weekStart: string, today: string = localToday()): string {
  const a = utc(weekStart)
  const b = utc(weekEndOf(weekStart))
  const thisYear = utc(today).getUTCFullYear()
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear()
  const startYear = !sameYear && a.getUTCFullYear() !== thisYear ? `, ${a.getUTCFullYear()}` : ''
  const endYear = b.getUTCFullYear() !== thisYear ? `, ${b.getUTCFullYear()}` : ''
  const start = `${MONTHS[a.getUTCMonth()]} ${a.getUTCDate()}${startYear}`
  const end = a.getUTCMonth() === b.getUTCMonth() ? `${b.getUTCDate()}` : `${MONTHS[b.getUTCMonth()]} ${b.getUTCDate()}`
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

/** The instants a period covers. Weeks run Sunday to Saturday, the way the
 *  week calendar reads; "30 days" is today and the 29 before it. */
export function periodRange(period: IdeatePeriod, now: Date = new Date()): PeriodRange {
  const today = localToday(now)
  const sunday = sundayOf(today)
  if (period === 'last-week') {
    const start = addDays(sunday, -7)
    return { from: midnight(start), to: midnight(sunday), weekStart: start }
  }
  if (period === '30-days') {
    return { from: midnight(addDays(today, -29)), to: midnight(addDays(today, 1)), weekStart: sunday }
  }
  return { from: midnight(sunday), to: midnight(addDays(sunday, 7)), weekStart: sunday }
}

// --- One campaign's videos --------------------------------------------------------

/** The campaigns in the Campaigns list's order, so the screens agree: the
 *  high-quality ones (a minimum views) first, then the quick ones, each best
 *  pay first (src/data/campaignOrder.ts). Archived ones are left out. */
export function campaignsInOrder<T extends Campaign>(campaigns: readonly T[], accounts: readonly CampaignAccount[]): T[] {
  return byRecordingPriority(byBestPay(campaigns.filter((c) => c.is_active !== false), accounts))
}

/** One post that went out: a video on one of the campaign's accounts. */
export interface CampaignPost {
  post: PostizPostView
  accountId: string
}

/** One video - one deliverable - however many accounts it went out on
 *  (CLAUDE.md, "A video is one deliverable, posted to every account"). Its
 *  posts share Postiz's group; a post with no group is a video of its own. */
export interface CampaignVideo {
  /** The group, or the post's id. */
  id: string
  /** Where it went out, one post per account: Instagram first, then the rest
   *  by platform name. */
  posts: CampaignPost[]
  /** When it first went out. */
  publishedAt: string | null
  /** Its views on every platform whose views have been read, added up; null
   *  while none has. */
  views: number | null
  /** How many of its posts are still waiting for their views. */
  unread: number
  /** Whichever of its posts has a preview - TikTok and YouTube do; Postiz
   *  gives Instagram none. */
  preview: { src: string; kind: 'image' | 'video' } | null
  /** The post a tap opens: the Instagram one when there is one, else the
   *  first with a link. */
  primary: CampaignPost
  caption: string
}

const time = (post: PostizPostView) => {
  const at = post.publishedAt ? instant(post.publishedAt) : NaN
  return Number.isFinite(at) ? at : -Infinity
}

const isHttp = (url: string | null): url is string => url !== null && /^https?:\/\//i.test(url)
const isInstagram = (platform: string) => platform.trim().toLowerCase().startsWith('instagram')

/** The campaign's posts that went out: Postiz posts whose platform and
 *  handle are exactly one of the campaign's switched-on accounts (mineFor).
 *  Scheduled and failed posts did not go out and are left out. */
export function postsForCampaign(
  posts: readonly PostizPostView[],
  accounts: readonly CampaignAccount[],
  campaignId: string,
): CampaignPost[] {
  const mine: MyAccount[] = accounts
    .filter((a) => a.campaign_id === campaignId && a.is_active)
    .map((a) => ({ id: a.id, platform: a.platform, handle: a.handle }))
  if (mine.length === 0) return []
  return posts
    .filter((post) => post.status === 'posted')
    .flatMap((post) => {
      const account = mineFor(mine, { name: post.handle, platform: post.platform, profile: post.handle })
      return account ? [{ post, accountId: account.id }] : []
    })
}

const viewsOf = (p: CampaignPost) => (typeof p.post.views === 'number' && Number.isFinite(p.post.views) ? p.post.views : null)

/** The campaign's videos that went out, newest first - its posts grouped by
 *  Postiz's group. */
export function videosForCampaign(
  posts: readonly PostizPostView[],
  accounts: readonly CampaignAccount[],
  campaignId: string,
): CampaignVideo[] {
  const groups = new Map<string, CampaignPost[]>()
  for (const item of postsForCampaign(posts, accounts, campaignId)) {
    const key = item.post.group ?? `post:${item.post.id}`
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  const videos = [...groups.entries()].map(([key, items]): CampaignVideo => {
    const sorted = [...items].sort(
      (a, b) =>
        Number(isInstagram(b.post.platform)) - Number(isInstagram(a.post.platform)) ||
        a.post.platform.localeCompare(b.post.platform) ||
        a.post.id.localeCompare(b.post.id),
    )
    const read = sorted.map(viewsOf).filter((v): v is number => v !== null)
    const first = [...sorted].sort((a, b) => time(a.post) - time(b.post))[0]
    const withPreview = sorted.find((p) => isHttp(p.post.preview))
    const primary =
      sorted.find((p) => isInstagram(p.post.platform) && isHttp(p.post.url)) ?? sorted.find((p) => isHttp(p.post.url)) ?? sorted[0]
    return {
      id: key.startsWith('post:') ? key.slice(5) : key,
      posts: sorted,
      publishedAt: first.post.publishedAt,
      views: read.length === 0 ? null : read.reduce((sum, v) => sum + v, 0),
      unread: sorted.length - read.length,
      preview: withPreview
        ? { src: withPreview.post.preview as string, kind: withPreview.post.previewKind === 'video' ? 'video' : 'image' }
        : null,
      primary,
      caption: sorted.find((p) => p.post.caption.trim() !== '')?.post.caption ?? '',
    }
  })
  const at = (v: CampaignVideo) => (v.publishedAt ? instant(v.publishedAt) : NaN)
  const order = (v: CampaignVideo) => (Number.isFinite(at(v)) ? at(v) : -Infinity)
  return videos.sort((a, b) => order(b) - order(a) || a.id.localeCompare(b.id))
}

/** True when the campaign has at least one switched-on account with a handle -
 *  without one, no video can be told to be the campaign's. */
export function hasHandles(accounts: readonly CampaignAccount[], campaignId: string): boolean {
  return accounts.some((a) => a.campaign_id === campaignId && a.is_active && (a.handle ?? '').trim().replace(/^@+/, '') !== '')
}

export interface VideoStats {
  /** Videos that went out in the period - one however many platforms. */
  posted: number
  /** How many of them have any views read. */
  read: number
  /** Per video, of the read ones only; null when none has been read. */
  average: number | null
  best: CampaignVideo | null
  /** Null until two have been read - one video is not both. */
  worst: CampaignVideo | null
}

/** The period's figures, per video. Only read views count: a video still
 *  waiting for its views is in `posted` and nowhere else. */
export function videoStats(videos: readonly CampaignVideo[]): VideoStats {
  const read = videos.filter((v) => v.views !== null)
  if (read.length === 0) return { posted: videos.length, read: 0, average: null, best: null, worst: null }
  const total = read.reduce((sum, v) => sum + (v.views as number), 0)
  // Most views first; between equals, the newer one (videos come newest first).
  const ranked = [...read].sort((a, b) => (b.views as number) - (a.views as number))
  return {
    posted: videos.length,
    read: read.length,
    average: Math.round(total / read.length),
    best: ranked[0],
    worst: ranked.length > 1 ? ranked[ranked.length - 1] : null,
  }
}

/** How many of these videos are still waiting for views on some platform -
 *  only while the server says it is still reading. A video Postiz will never
 *  read is not "coming in". */
export function viewsComingIn(videos: readonly CampaignVideo[], reading: number): number {
  if (reading <= 0) return 0
  return videos.filter((v) => v.unread > 0).length
}
