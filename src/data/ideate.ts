// The IDEATE screen's arithmetic: one week of one campaign, per account.
//
// Pure functions over rows already loaded, so the screen and the tests read
// one definition of "this account's week". Nothing here writes, and nothing
// here makes a number up:
//
//   - posts are counted from video_posts, one per tick, in the local week
//     (Sunday to Saturday, the way he reads a calendar);
//   - money is the earnings history (earnings_events), which records the
//     account each tick paid on, summed over the week's days - the same
//     append-only ledger every other money figure comes from;
//   - views are the cutter's own readings, matched to his accounts with
//     mineFor, exactly as the campaign's Analytics reads them. Read only.

import type { CutterViewsPost, MyAccount } from './campaignViews'
import { mineFor } from './campaignViews'
import { localToday } from './index'
import type { Campaign, CampaignAccount, EarningsEvent, IdeateNote, PlanBlock, Video, VideoPost } from './schema'
import { IDEATE_RECOMMENDED, WEEKDAYS_SHORT, hours, sortByWeek } from './weeklyPlan'

// --- The week ----------------------------------------------------------------

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

export function inWeek(date: string, weekStart: string): boolean {
  return date >= weekStart && date <= weekEndOf(weekStart)
}

/** The week as instants: its Sunday's local midnight up to the next one's. */
export function weekBounds(weekStart: string): { from: number; to: number } {
  const [y, m, d] = weekStart.split('-').map(Number)
  return { from: new Date(y, m - 1, d).getTime(), to: new Date(y, m - 1, d + 7).getTime() }
}

/** The local calendar day an instant fell on. */
export function localDay(iso: string): string {
  return localToday(new Date(iso))
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

// --- His ideate time, from the saved week ------------------------------------

/** "10 am", "6:30 pm" */
export function shortClock(minute: number): string {
  const h = Math.floor(minute / 60) % 24
  const m = minute % 60
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}${m === 0 ? '' : `:${String(m).padStart(2, '0')}`} ${h < 12 ? 'am' : 'pm'}`
}

/** "Your ideate time this week: Tue 10 am, Thu 10 am · 2h of 2–4h
 *  recommended", from the ideate blocks he placed. Null when he placed none. */
export function ideateTimeLine(blocks: readonly Pick<PlanBlock, 'kind' | 'weekday' | 'start_minute' | 'duration_minutes'>[]): string | null {
  const ideate = sortByWeek(blocks.filter((b) => b.kind === 'ideate'))
  if (ideate.length === 0) return null
  const total = ideate.reduce((sum, b) => sum + b.duration_minutes, 0)
  const when = ideate.map((b) => `${WEEKDAYS_SHORT[b.weekday]} ${shortClock(b.start_minute)}`).join(', ')
  return `Your ideate time this week: ${when} · ${hours(total)} of ${IDEATE_RECOMMENDED.min / 60}–${IDEATE_RECOMMENDED.max / 60}h recommended`
}

// --- One campaign's week -----------------------------------------------------

export interface WeekPost {
  post: VideoPost
  /** The local day it went out. */
  day: string
  /** Which of the campaign's videos this week it is: 1 for the first that
   *  went out, and the same number on every account it was cross-posted to. */
  videoNumber: number
  video: Video | null
  /** The other platforms the same video went to, on this campaign. */
  alsoOn: string[]
}

export interface AccountWeek {
  account: CampaignAccount
  /** This account's posts in the week, oldest first. Each tick is one. */
  posts: WeekPost[]
  /** Net earnings the history records on this account in the week. */
  cents: number
}

export interface CampaignWeek {
  campaign: Campaign
  accounts: AccountWeek[]
  /** Deliverables that first went out this week, on any account it pays for
   *  - one video cross-posted to three platforms is one. */
  videosPosted: number
  /** Net earnings the history records for the campaign in the week. */
  cents: number
  /** The part of `cents` on no account listed here: a tick written before
   *  ticks named their account, or on an account since removed. */
  unlistedCents: number
}

/** One campaign's week, per account, from rows already loaded. `accounts` may
 *  hold every campaign's; only this campaign's are used. */
export function campaignWeek(
  campaign: Campaign,
  accounts: readonly CampaignAccount[],
  videos: readonly Video[],
  posts: readonly VideoPost[],
  events: readonly EarningsEvent[],
  weekStart: string,
): CampaignWeek {
  const mine = accounts.filter((a) => a.campaign_id === campaign.id && a.is_active)
  const byId = new Map(mine.map((a) => [a.id, a]))
  const videoById = new Map(videos.map((v) => [v.id, v]))

  const all = posts
    .filter((p) => p.account_id !== null && byId.has(p.account_id))
    .map((post) => ({ post, day: localDay(post.posted_at) }))
    .sort((a, b) => a.post.posted_at.localeCompare(b.post.posted_at) || a.post.id.localeCompare(b.post.id))
  const week = all.filter((p) => inWeek(p.day, weekStart))

  const numbers = new Map<string, number>()
  for (const { post } of week) if (!numbers.has(post.video_id)) numbers.set(post.video_id, numbers.size + 1)

  const platformsOf = new Map<string, string[]>()
  for (const { post } of all) platformsOf.set(post.video_id, [...(platformsOf.get(post.video_id) ?? []), post.platform])

  // A deliverable counts in the week it FIRST went out on an account that is
  // owed - a bonus-only account's post is an extra, as on the Post grid.
  const firstOut = new Map<string, string>()
  for (const { post, day } of all) {
    if (byId.get(post.account_id as string)?.bonus_only) continue
    if (!firstOut.has(post.video_id)) firstOut.set(post.video_id, day)
  }
  const videosPosted = [...firstOut.values()].filter((day) => inWeek(day, weekStart)).length

  const weekEvents = events.filter((e) => e.campaign_id === campaign.id && inWeek(e.earned_on, weekStart))
  const net = (list: readonly EarningsEvent[]) => list.reduce((sum, e) => sum + e.amount_cents, 0)

  const accountWeeks = mine.map((account) => ({
    account,
    posts: week
      .filter(({ post }) => post.account_id === account.id)
      .map(({ post, day }) => ({
        post,
        day,
        videoNumber: numbers.get(post.video_id) as number,
        video: videoById.get(post.video_id) ?? null,
        alsoOn: (platformsOf.get(post.video_id) ?? []).filter((p) => p !== post.platform),
      })),
    cents: net(weekEvents.filter((e) => e.account_id === account.id)),
  }))

  const cents = net(weekEvents)
  return {
    campaign,
    accounts: accountWeeks,
    videosPosted,
    cents,
    unlistedCents: cents - accountWeeks.reduce((sum, a) => sum + a.cents, 0),
  }
}

// --- Views, read only --------------------------------------------------------

export interface AccountWeekViews {
  /** His posts on this account that went out in the week, as the cutter has them. */
  posts: number
  /** How many of those the cutter has read. */
  read: number
  /** Their latest readings added up; null when none has been read. */
  views: number | null
  /** How many of the read ones reached the campaign's minimum. */
  reachedMin: number
}

/** Per account of his, the cutter's readings of the posts that went out in
 *  [from, to). Only accounts that are exactly his count (mineFor) - the
 *  cutter is shared with Jake. Keyed by planner account id; every one of
 *  `mine` has an entry. */
export function weekViewsByAccount(
  posts: readonly CutterViewsPost[],
  mine: readonly MyAccount[],
  from: number,
  to: number,
  minViews: number | null,
): Map<string, AccountWeekViews> {
  const out = new Map<string, AccountWeekViews>(mine.map((a) => [a.id, { posts: 0, read: 0, views: null, reachedMin: 0 }]))
  for (const post of posts) {
    const at = Date.parse(post.postedAt)
    if (!Number.isFinite(at) || at < from || at >= to) continue
    for (const sent of post.accounts) {
      const account = mineFor(mine, sent)
      if (!account) continue
      const entry = out.get(account.id)!
      entry.posts++
      const v = post.views[sent.name]
      if (typeof v !== 'number') continue
      entry.read++
      entry.views = (entry.views ?? 0) + v
      if (minViews !== null && v >= minViews) entry.reachedMin++
    }
  }
  return out
}

// --- Notes -------------------------------------------------------------------

/** One scope's notes - an account's, or the campaign's as a whole when
 *  `accountId` is null - split into the week shown and the weeks before it,
 *  newest week first. */
export function notesFor(
  notes: readonly IdeateNote[],
  campaignId: string,
  accountId: string | null,
  weekStart: string,
): { thisWeek: IdeateNote[]; earlier: { weekStart: string; notes: IdeateNote[] }[] } {
  const scoped = notes.filter((n) => n.campaign_id === campaignId && n.account_id === accountId)
  const thisWeek = scoped
    .filter((n) => n.week_start === weekStart)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id))
  const weeks = new Map<string, IdeateNote[]>()
  for (const note of scoped.filter((n) => n.week_start < weekStart)) {
    weeks.set(note.week_start, [...(weeks.get(note.week_start) ?? []), note])
  }
  const earlier = [...weeks.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([start, list]) => ({ weekStart: start, notes: list.sort((a, b) => a.created_at.localeCompare(b.created_at)) }))
  return { thisWeek, earlier }
}
