// What has to go out today, and where - the model behind the Post screen.
//
// The shape of the problem, in his words: "Posts owed per day: 1, Platforms:
// YouTube + Instagram + TikTok means there should be 3 separate
// platform-specific post items under Inflow, each with its own checkbox."
//
// So a campaign's board is a grid:
//
//     rows    = the campaign's accounts (one per platform it posts to)
//     columns = SLOTS, one per deliverable owed today (daily_post_quota)
//     cell    = did this deliverable go out on this platform today?
//
// Two rules hold the whole thing together:
//
//   1. A slot is ONE deliverable. Ticking Instagram, TikTok and YouTube for
//      slot 1 records three video_posts against the SAME video, so it is
//      earned once. This is what stops the platform count from multiplying
//      either the daily obligation or the money.
//   2. Ticking is never gated on anything having been filmed in the app. He
//      films elsewhere, edits elsewhere, and posts things this app never saw.
//      A tick with no suitable video behind it creates one; it does not
//      refuse. "Nothing ready to post" was the app telling him his own work
//      did not happen.

import type { DataAdapter } from './DataAdapter'
import { localToday } from './index'
import type { Campaign, CampaignAccount, Video, VideoPost } from './schema'
import { canPostFrom } from './warmup'

export interface PostingCell {
  slot: number
  account: CampaignAccount
  /** Today's post on this platform for this deliverable, if it went out. */
  post: VideoPost | null
}

export interface PostingRow {
  account: CampaignAccount
  cells: PostingCell[]
}

export interface PostingBoard {
  campaign: Campaign
  /** Slot index -> the deliverable occupying it today, once it has one. */
  videoIdBySlot: (string | null)[]
  /** How many deliverables the campaign owes today. */
  quota: number
  /** Columns to render: the quota, or more if he over-delivered. */
  slots: number
  rows: PostingRow[]
  /** Deliverables that went out today on at least one platform. */
  doneToday: number
}

/** The order a new slot reaches for a video: finished stock first, then
 *  anything else unposted, oldest first. Posting drains what is already made
 *  before it invents a new row, which is what keeps "days of posts banked"
 *  meaning something. */
const PHASE_RANK: Record<string, number> = { edited: 0, filmed: 1, to_film: 2 }

function rank(video: Video): number {
  return PHASE_RANK[video.phase] ?? 3
}

export function pickVideoForSlot(
  videos: readonly Video[],
  campaignId: string,
  taken: ReadonlySet<string>,
): Video | null {
  const candidates = videos
    .filter((v) => v.campaign_id === campaignId && v.phase !== 'posted' && !taken.has(v.id))
    .sort((a, b) => rank(a) - rank(b) || a.created_at.localeCompare(b.created_at))
  return candidates[0] ?? null
}

/** Builds one campaign's board for `date` from rows already loaded.
 *
 *  Which deliverable sits in which slot is derived, never stored: the videos
 *  that received a post today, ordered by when their first post landed. That
 *  makes the board survive a refresh with no extra state to keep in step, and
 *  makes tomorrow's board empty without anything having to run at midnight. */
export function buildBoard(
  campaign: Campaign,
  accounts: readonly CampaignAccount[],
  posts: readonly VideoPost[],
  date: string = localToday(),
): PostingBoard {
  // Accounts he can actually post from. One still warming up is one he must
  // not post brand content from yet, so offering it a box is offering him a
  // mistake - "If a campaign is not set to ready then dont put it in the post
  // tab." It is not hidden work: the home screen names every account still
  // warming and takes him straight into warming it up. Platforms that do not
  // warm up at all (YouTube) are always postable - see canPostFrom.
  const mine = accounts.filter(
    (a) => a.campaign_id === campaign.id && a.is_active && canPostFrom(a),
  )
  const accountIds = new Set(mine.map((a) => a.id))

  const todays = posts
    .filter(
      (p) =>
        p.account_id !== null &&
        accountIds.has(p.account_id) &&
        localToday(new Date(p.posted_at)) === date,
    )
    .sort((a, b) => a.posted_at.localeCompare(b.posted_at))

  const videoIdBySlot: string[] = []
  for (const post of todays) {
    if (!videoIdBySlot.includes(post.video_id)) videoIdBySlot.push(post.video_id)
  }

  const quota = campaign.daily_post_quota
  // Never fewer columns than deliverables he actually posted: over-delivering
  // is real and has to be visible, rather than the extra work vanishing or
  // pushing the count past a denominator that cannot explain it.
  const slots = Math.max(quota, videoIdBySlot.length)

  const rows: PostingRow[] = mine.map((account) => ({
    account,
    cells: Array.from({ length: slots }, (_, slot) => {
      const videoId = videoIdBySlot[slot] ?? null
      const post =
        videoId === null
          ? null
          : (todays.find((p) => p.video_id === videoId && p.account_id === account.id) ?? null)
      return { slot, account, post }
    }),
  }))

  return {
    campaign,
    videoIdBySlot: Array.from({ length: slots }, (_, i) => videoIdBySlot[i] ?? null),
    quota,
    slots,
    rows,
    doneToday: videoIdBySlot.length,
  }
}

/** Every board the Post tab shows today, in one place.
 *
 *  This exists because the home screen and the Post tab used to work today out
 *  separately - Now summed raw daily_post_quota over every campaign and counted
 *  every video_post in the store, while Post built boards, filtered them, and
 *  only counted posts on accounts he can post from. Two derivations of one
 *  number cannot help but drift, and they did: a day he had filled on the Post
 *  tab still read as unfinished on the home screen. Both screens now render
 *  this, so the home count IS the Post tab summed, by construction rather than
 *  by two pieces of arithmetic agreeing.
 *
 *  A campaign is on the tab when he can post it (it has an account he can post
 *  from) or when it has no accounts at all - the second says "add one", which
 *  is the only way that gets fixed. A campaign whose every account is still
 *  warming up is off the tab and off the count: it belongs to the warm-up list
 *  on the home screen, and owing him a number he has no way to fill is the
 *  thing this app must never do. */
export function boardsForToday(
  campaigns: readonly Campaign[],
  accounts: readonly CampaignAccount[],
  posts: readonly VideoPost[],
  date: string = localToday(),
): PostingBoard[] {
  return campaigns
    .map((campaign) => buildBoard(campaign, accounts, posts, date))
    .filter((board) => {
      if (board.rows.length > 0) return true
      if (board.quota <= 0) return false
      return !accounts.some((a) => a.campaign_id === board.campaign.id && a.is_active)
    })
}

/** What today owes and what has gone out, summed off those boards. */
export function tallyBoards(boards: readonly PostingBoard[]): { owed: number; posted: number } {
  return {
    owed: boards.reduce((sum, board) => sum + board.quota, 0),
    posted: boards.reduce((sum, board) => sum + board.doneToday, 0),
  }
}

/** Records that this deliverable went out on this platform.
 *
 *  Binds the slot to a deliverable if it has none yet - reusing stock where
 *  there is any, creating a row where there is not - and marks that
 *  deliverable posted the first time it goes out anywhere, which is the
 *  moment its rate is locked in. Posting it to a second platform afterwards
 *  adds a destination, never a second payment. */
export async function markPosted(
  data: DataAdapter,
  board: PostingBoard,
  account: CampaignAccount,
  slot: number,
  videos: readonly Video[],
  date: string = localToday(),
): Promise<void> {
  let videoId = board.videoIdBySlot[slot] ?? null

  if (videoId === null) {
    const taken = new Set(board.videoIdBySlot.filter((id): id is string => id !== null))
    const existing = pickVideoForSlot(videos, board.campaign.id, taken)
    if (existing) {
      videoId = existing.id
    } else {
      const created = await data.createVideo({
        campaign_id: board.campaign.id,
        kind: 'contracted',
        setup: board.campaign.default_setup,
        angle_id: null,
        script: null,
        blocked_reason: null,
        owed_for_date: date,
        rate_snapshot_cents: null,
        posted_at: null,
      })
      videoId = created.id
    }
  }

  const already = await data.listVideoPosts(videoId)
  if (!already.some((p) => p.account_id === account.id)) {
    await data.addVideoPost({
      video_id: videoId,
      account_id: account.id,
      platform: account.platform,
      url: null,
      view_count: null,
      view_count_entered_at: null,
    })
  }

  const current = await data.getVideo(videoId)
  if (current !== null && current.phase !== 'posted') {
    await data.markVideoPosted(videoId, { session: 'post' })
  }
}

/** Takes a post back off a platform.
 *
 *  The deliverable stays posted while it is still out anywhere else - it did
 *  go out, and un-earning it because one of three platforms was unticked
 *  would be wrong. Only when the last destination is removed does it stop
 *  counting, which also releases its rate snapshot. */
export async function unmarkPosted(
  data: DataAdapter,
  account: CampaignAccount,
  post: VideoPost,
): Promise<void> {
  await data.removeVideoPost(post.video_id, account.id)

  const left = await data.listVideoPosts(post.video_id)
  if (left.length === 0) {
    const current = await data.getVideo(post.video_id)
    if (current !== null && current.phase === 'posted') {
      await data.undoLastPhaseMove(post.video_id, { session: 'post' })
    }
  }
}
