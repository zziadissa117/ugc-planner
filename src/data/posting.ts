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
  videos: readonly Video[],
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

  const todays = posts.filter(
    (p) =>
      p.account_id !== null &&
      accountIds.has(p.account_id) &&
      localToday(new Date(p.posted_at)) === date,
  )

  // THE SLOTS ARE THE OWED VIDEO ROWS, in the order they were raised.
  //
  // They already exist: ensureTodaysQuota creates one per unit of the
  // campaign's daily quota before this screen ever renders, and a row's
  // created_at does not change. So box 3 is the third deliverable owed today,
  // today, tomorrow and after a reload.
  //
  // It used to be built the other way round - the videos that had received a
  // post today, packed in from the left - and that moved the boxes under his
  // thumb. Ticking box 3 put the tick in box 1, because box 1 was simply the
  // first entry of a list one item long. Clicking box 1 next then landed on a
  // cell that already held that post and silently took it back down, which is
  // how he found it: "There are some cases when i click on them they dont make
  // noise." CLAUDE.md has said since the beginning that a box must stay in
  // place; this is what was breaking it.
  const quota = campaign.daily_post_quota

  const owedAll = videos
    .filter((v) => v.campaign_id === campaign.id && v.owed_for_date === date)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map((v) => v.id)

  // THE QUOTA DECIDES HOW MANY OF THOSE ROWS ARE BOXES.
  //
  // ensureTodaysQuota only ever adds rows. So a campaign that owed 2 a day
  // and was cut to 1 kept its second row for the rest of the day, and the
  // board drew a box for it - two boxes to tick for one post owed, which is
  // the campaign's number being ignored by the very screen that exists to
  // count it. The rows stay in the store (raising the quota again brings the
  // box back, and nothing is deleted from a ledger), but only as many
  // UNPOSTED ones as the quota still has room for are drawn.
  //
  // A row that has been posted is always drawn, whatever the quota says now:
  // it went out, over-delivering has to be visible, and a box he ticked must
  // never vanish. Rows keep their original order, so no box changes place.
  const postedIds = new Set(todays.map((p) => p.video_id))
  let room = Math.max(0, quota - owedAll.filter((id) => postedIds.has(id)).length)
  const owed = owedAll.filter((id) => {
    if (postedIds.has(id)) return true
    if (room > 0) {
      room -= 1
      return true
    }
    return false
  })

  // Anything posted today that is not one of those rows: stock drained from
  // the backlog, or an extra beyond the quota. Appended in the order it went
  // out, so over-delivery is visible rather than vanishing.
  const extra = todays
    .slice()
    .sort((a, b) => a.posted_at.localeCompare(b.posted_at))
    .map((p) => p.video_id)
    .filter((id, index, all) => all.indexOf(id) === index && !owed.includes(id))

  const videoIdBySlot = [...owed, ...extra]

  // Never fewer columns than there are deliverables to show: over-delivering
  // is real and has to be visible.
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

  // Counted rather than taken from the length of the slot list: that list is
  // now the day's obligation, most of which has not gone out yet.
  // A post on a bonus-only account is an extra, not part of what is owed, so
  // it never counts a deliverable as done.
  const bonusOnly = new Set(mine.filter((a) => a.bonus_only).map((a) => a.id))
  const postedVideoIds = new Set(
    todays.filter((p) => p.account_id === null || !bonusOnly.has(p.account_id)).map((p) => p.video_id),
  )
  const doneToday = videoIdBySlot.filter((id) => postedVideoIds.has(id)).length

  return {
    campaign,
    videoIdBySlot: Array.from({ length: slots }, (_, i) => videoIdBySlot[i] ?? null),
    quota,
    slots,
    rows,
    doneToday,
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
  videos: readonly Video[],
  posts: readonly VideoPost[],
  date: string = localToday(),
): PostingBoard[] {
  return campaigns
    .map((campaign) => buildBoard(campaign, accounts, videos, posts, date))
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

/** What the deliverables posted on `date` are worth, in cents.
 *
 *  Off the rate each video snapshotted when it went out, not off the
 *  campaign's rate today: the snapshot is what makes the ledger
 *  non-rewritable, and a rate changed next month must not repay last night.
 *
 *  Counted per DELIVERABLE, not per tick. A video cross-posted to three
 *  platforms earned once, so ticking the second and third platform adds
 *  destinations and no money - which is the whole reason the figure is built
 *  from de-duplicated video ids rather than from the posts themselves.
 *
 *  A video posted before it had a rate contributes nothing rather than zero
 *  dollars pretending to be a price. It is picked up later by
 *  backfillUnpricedVideos when a rate first arrives. */
export function earnedOn(
  videos: readonly Video[],
  posts: readonly VideoPost[],
  date: string = localToday(),
  campaigns: readonly Campaign[] = [],
  accounts: readonly CampaignAccount[] = [],
): number {
  const rateById = new Map(videos.map((video) => [video.id, video.rate_snapshot_cents]))
  const campaignById = new Map(videos.map((video) => [video.id, video.campaign_id]))
  const perPlatform = new Set(campaigns.filter((c) => c.pays_per_platform).map((c) => c.id))
  const known = new Set(campaigns.map((c) => c.id))
  // Accounts paid only through bonuses earn nothing per post, so a tick on one
  // is left out entirely - see campaign_accounts.bonus_only.
  const bonusOnly = new Set(accounts.filter((a) => a.bonus_only).map((a) => a.id))

  const destinations = new Map<string, Set<string>>()
  for (const post of posts) {
    if (localToday(new Date(post.posted_at)) !== date) continue
    if (post.account_id !== null && bonusOnly.has(post.account_id)) continue
    const set = destinations.get(post.video_id) ?? new Set<string>()
    set.add(post.account_id ?? post.platform)
    destinations.set(post.video_id, set)
  }

  let cents = 0
  for (const [videoId, ticked] of destinations) {
    const rate = rateById.get(videoId) ?? 0
    const campaignId = campaignById.get(videoId) ?? ''

    if (perPlatform.has(campaignId)) {
      // Every platform pays the full rate on its own.
      cents += rate * ticked.size
    } else if (known.has(campaignId)) {
      // The rate is for the deliverable on all of the campaign's paying
      // accounts, so each one ticked earns its share of it. Rounded on the
      // whole so a rate that does not divide evenly still adds up to exactly
      // the rate once every paying platform is ticked.
      const paying = accounts.filter(
        (a) => a.campaign_id === campaignId && a.is_active && !a.bonus_only && canPostFrom(a),
      ).length
      const total = Math.max(1, paying)
      cents += Math.round((rate * Math.min(ticked.size, total)) / total)
    } else {
      cents += rate
    }
  }
  return cents
}

/** The box a tap in the neural view should fill: the campaign's first ready
 *  account, in slot order - the same box a first tap on that row of the list
 *  view would fill. Once every owed slot on that account is posted, one more
 *  beyond the quota, exactly like the list view's dashed "+" button. Null
 *  only when the campaign has no account he can post from at all. */
export function nextUnfilledCell(
  board: PostingBoard,
): { account: CampaignAccount; slot: number } | null {
  const row = board.rows.find((r) => !r.account.bonus_only) ?? board.rows[0]
  if (!row) return null
  const open = row.cells.find((cell) => cell.post === null)
  return open ? { account: row.account, slot: open.slot } : { account: row.account, slot: board.slots }
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
