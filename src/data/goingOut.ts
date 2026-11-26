// TODAY's "Going out", by campaign: for each campaign, how many videos are
// lined up for the day (or the week) against how many it owes - "GoDaddy, 20
// out of 20, Pump Fund 5 out of 10" - so in the morning he can see what is
// still to do.
//
// Pure functions over posts already read (src/sync/postizPosts.ts) and the
// planner's own campaigns. Nothing here writes or ticks anything.
//
//   - A video is ONE deliverable however many accounts it went to (CLAUDE.md):
//     posts that share Postiz's `group` are one video, and a post with no
//     group is a video of its own. Account-posts are never counted.
//   - Which campaign a video belongs to is postHome.ts's rule, and only that.
//   - Lined up = out or scheduled. A video made in the cutter and waiting for
//     his approval, or one that failed, is not lined up - it is still to do.
//   - What a campaign owes is its own quota: `daily_post_quota` for a day,
//     `posts_per_week` for the week. A cutter campaign the planner has no
//     campaign for owes nothing the planner knows of, so it has no "of Y".

import type { PostizPostView } from '../sync/postizPosts'
import { campaignsInOrder } from './ideate'
import { homeKey, homeOfPost, type PostHome } from './postHome'
import type { Campaign, CampaignAccount } from './schema'

export type GoingOutSpan = 'today' | 'week'
export type VideoStatus = PostizPostView['status']

/** Videos by where they stand. */
export interface GoingOutCounts {
  posted: number
  scheduled: number
  waiting: number
  failed: number
}

/** One video - one deliverable - and the posts it went out as. */
export interface GoingOutVideo {
  /** The group, or the post's id. */
  id: string
  /** One per account: Instagram first, then by platform name. */
  posts: PostizPostView[]
  /** When it first goes (or went) out. */
  publishedAt: string
  /** Out the first time it is out anywhere; otherwise scheduled, then
   *  waiting for approval, and failed only when every post failed. */
  status: VideoStatus
  /** The caption's first line, or '' when it has none. */
  caption: string
  /** The live link to open: the Instagram post's, else any posted one's. */
  url: string | null
}

export interface GoingOutRow {
  /** homeKey: the planner campaign's id, `cutter:<id>`, or 'none'. */
  key: string
  kind: PostHome['kind']
  name: string
  /** Videos out or scheduled in the span. */
  lined: number
  /** What the campaign owes for the span; null when the planner knows of no
   *  quota for it (a cutter-only campaign, "Other accounts"). */
  owed: number | null
  counts: GoingOutCounts
  /** In time order. */
  videos: GoingOutVideo[]
}

export interface GoingOutInput {
  posts: readonly PostizPostView[]
  campaigns: readonly Campaign[]
  accounts: readonly CampaignAccount[]
  span: GoingOutSpan
  /** The span's instants: from inclusive, to exclusive. */
  from: Date
  to: Date
}

export const OTHER_ACCOUNTS = 'Other accounts'

/** An ISO instant as milliseconds, whatever its spelling - the server can
 *  write microseconds and "+00:00". NaN for anything that is not one. */
function instant(iso: string): number {
  return Date.parse(iso.trim().replace(/(\.\d{3})\d+/, '$1'))
}

function firstLine(caption: string): string {
  return caption.split('\n').find((line) => line.trim() !== '')?.trim() ?? ''
}

const platformOrder = (a: PostizPostView, b: PostizPostView) => {
  const ia = a.platform.toLowerCase() === 'instagram' ? 0 : 1
  const ib = b.platform.toLowerCase() === 'instagram' ? 0 : 1
  return ia - ib || a.platform.localeCompare(b.platform) || a.handle.localeCompare(b.handle)
}

function statusOf(posts: readonly PostizPostView[]): VideoStatus {
  for (const status of ['posted', 'scheduled', 'waiting'] as const) {
    if (posts.some((p) => p.status === status)) return status
  }
  return 'failed'
}

/** The posts in the span as videos, each with where it belongs. */
export function videosInSpan(
  input: Pick<GoingOutInput, 'posts' | 'campaigns' | 'accounts' | 'from' | 'to'>,
): { video: GoingOutVideo; home: PostHome }[] {
  const from = input.from.getTime()
  const to = input.to.getTime()
  const groups = new Map<string, PostizPostView[]>()
  for (const post of input.posts) {
    if (!post.publishedAt) continue
    const at = instant(post.publishedAt)
    if (!(at >= from && at < to)) continue
    const id = post.group ?? post.id
    groups.set(id, [...(groups.get(id) ?? []), post])
  }

  return [...groups].map(([id, group]) => {
    const posts = [...group].sort(platformOrder)
    // A video is placed once: by the first of its posts the rules can put on
    // a planner campaign, else on a cutter campaign, else nowhere.
    const homes = posts.map((post) => homeOfPost(post, input.campaigns, input.accounts))
    const home = homes.find((h) => h.kind === 'campaign') ?? homes.find((h) => h.kind === 'cutter') ?? { kind: 'none' as const }
    const first = posts.reduce((a, b) => (instant(b.publishedAt!) < instant(a.publishedAt!) ? b : a))
    const live = posts.filter((p) => p.status === 'posted' && p.url)
    return {
      home,
      video: {
        id,
        posts,
        publishedAt: first.publishedAt!,
        status: statusOf(posts),
        caption: firstLine(posts.find((p) => firstLine(p.caption) !== '')?.caption ?? ''),
        url: (live.find((p) => p.platform.toLowerCase() === 'instagram') ?? live[0])?.url ?? null,
      },
    }
  })
}

function countsOf(videos: readonly GoingOutVideo[]): GoingOutCounts {
  const counts: GoingOutCounts = { posted: 0, scheduled: 0, waiting: 0, failed: 0 }
  for (const video of videos) counts[video.status]++
  return counts
}

function rowOf(key: string, kind: PostHome['kind'], name: string, owed: number | null, videos: GoingOutVideo[]): GoingOutRow {
  const sorted = [...videos].sort((a, b) => instant(a.publishedAt) - instant(b.publishedAt) || a.id.localeCompare(b.id))
  const counts = countsOf(sorted)
  return { key, kind, name, lined: counts.posted + counts.scheduled, owed, counts, videos: sorted }
}

/** True while a campaign owes more than is lined up. */
export function isShort(row: Pick<GoingOutRow, 'lined' | 'owed'>): boolean {
  return row.owed !== null && row.lined < row.owed
}

/** The rows "Going out" shows, in order: the planner's campaigns still short
 *  (in the Campaigns list's order), then the ones covered, then cutter
 *  campaigns the planner has no campaign for (most lined up first), then
 *  "Other accounts" for posts no rule could place.
 *
 *  A planner campaign is listed when it owes something in the span - with
 *  nothing lined up it reads "0 of 4", which is the point - or when it has
 *  videos in it. */
export function goingOutRows(input: GoingOutInput): GoingOutRow[] {
  const byHome = new Map<string, { home: PostHome; videos: GoingOutVideo[] }>()
  for (const { video, home } of videosInSpan(input)) {
    const key = homeKey(home)
    const entry = byHome.get(key) ?? { home, videos: [] }
    entry.videos.push(video)
    byHome.set(key, entry)
  }

  const planner = campaignsInOrder(input.campaigns, input.accounts).flatMap((campaign) => {
    const owes = input.span === 'today' ? campaign.daily_post_quota : campaign.posts_per_week
    const videos = byHome.get(campaign.id)?.videos ?? []
    if (!(owes > 0) && videos.length === 0) return []
    return [rowOf(campaign.id, 'campaign', campaign.name, owes > 0 ? owes : null, videos)]
  })

  const cutter = [...byHome.entries()]
    .flatMap(([key, { home, videos }]) => (home.kind === 'cutter' ? [rowOf(key, 'cutter', home.name, null, videos)] : []))
    .sort((a, b) => b.lined - a.lined || b.videos.length - a.videos.length || a.name.localeCompare(b.name))

  const unplaced = byHome.get('none')
  const other = unplaced ? [rowOf('none', 'none', OTHER_ACCOUNTS, null, unplaced.videos)] : []

  return [...planner.filter(isShort), ...planner.filter((row) => !isShort(row)), ...cutter, ...other]
}

/** "3 out · 2 scheduled · 1 to approve · 1 failed", leaving out the noughts;
 *  '' when there is nothing. */
export function breakdown(counts: GoingOutCounts): string {
  return [
    counts.posted > 0 ? `${counts.posted} out` : null,
    counts.scheduled > 0 ? `${counts.scheduled} scheduled` : null,
    counts.waiting > 0 ? `${counts.waiting} to approve` : null,
    counts.failed > 0 ? `${counts.failed} failed` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Today's videos for each of the planner's campaigns, in time order - the
 *  Post screen's line beside a campaign's name: "1 posted · 9:04 am",
 *  "1 scheduled · 6:00 pm". Read only, and only beside the name: nothing
 *  here ticks, colours or moves a Post box (CLAUDE.md, "He ticks every Post
 *  box himself"). Placed by the same rule as Going out, so the two agree. */
export function videosByCampaign(
  input: Pick<GoingOutInput, 'posts' | 'campaigns' | 'accounts' | 'from' | 'to'>,
): Map<string, GoingOutVideo[]> {
  const out = new Map<string, GoingOutVideo[]>()
  for (const { video, home } of videosInSpan(input)) {
    if (home.kind !== 'campaign') continue
    out.set(home.campaignId, [...(out.get(home.campaignId) ?? []), video])
  }
  for (const videos of out.values()) videos.sort((a, b) => instant(a.publishedAt) - instant(b.publishedAt) || a.id.localeCompare(b.id))
  return out
}

/** One status's share of a campaign's day: how many, and when each goes (or
 *  went) out, in time order. */
export interface LineUpPart {
  status: VideoStatus
  count: number
  times: string[]
}

/** Out, then scheduled, then waiting for his approval, then failed - only
 *  the ones there are. */
export function lineUp(videos: readonly GoingOutVideo[]): LineUpPart[] {
  return (['posted', 'scheduled', 'waiting', 'failed'] as const).flatMap((status) => {
    const times = videos.filter((v) => v.status === status).map((v) => v.publishedAt)
    return times.length > 0 ? [{ status, count: times.length, times }] : []
  })
}
