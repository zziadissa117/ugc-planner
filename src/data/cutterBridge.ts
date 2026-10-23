// Ticks the Post grid for videos the cutter app has posted.
//
// The cutter reports a post only once Postiz confirms it went out; this turns
// each one into the same ticks he would make by hand (markPosted), so the
// rate snapshot, the earnings history and the one-deliverable-many-platforms
// rule all behave exactly as for a manual tick.
//
// Idempotent across devices: each tick records where it went in
// video_posts.url - the platform's link when the cutter has one, otherwise
// `cutter:<post id>:<platform>` - and a post whose url is already there is
// skipped. video_posts syncs, so a second device doing the same pass finds
// the first one's ticks and adds nothing.
//
// Only a campaign he linked (campaigns.cutter_campaign_id) is touched, and
// only accounts of it whose platform matches one the cutter posted to.
// Nothing is guessed from a name.

import type { DataAdapter } from './DataAdapter'
import { localToday } from './index'
import { boardsForToday, markPosted, unmarkPosted, type PostingBoard } from './posting'
import type { CampaignAccount, VideoPost } from './schema'

/** One account a cutter post went to. */
export interface CutterAccount {
  /** Postiz's display name for it ("Danny | Growth Marketer"). */
  name: string
  platform: string
  /** Its handle on the platform ("hooksandmike") - absent from a function
   *  deployed before it was sent. */
  profile?: string
}

export interface CutterPost {
  id: string
  campaignId: string
  campaignName: string
  accounts: CutterAccount[]
  links: Record<string, string>
  postedAt: string
  /** When the cutter last changed it - where the next pass starts from. */
  updatedAt?: string
  /** Its views by account name, as the cutter last read them (a day, three
   *  days and a week after it went out) - for the views tracker. */
  views?: Record<string, number>
}

const ROOTS = ['tiktok', 'instagram', 'youtube', 'facebook', 'twitter', 'linkedin', 'threads', 'pinterest']

const PLATFORM_NAMES: Record<string, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
  facebook: 'Facebook',
  twitter: 'X',
  linkedin: 'LinkedIn',
  threads: 'Threads',
  pinterest: 'Pinterest',
}

/** "tiktok-business" and "TikTok" are both "tiktok". Unknown names stay as
 *  they are, letters only. */
export function platformRoot(platform: string): string {
  const flat = platform.toLowerCase().replace(/[^a-z0-9]/g, '')
  return ROOTS.find((root) => flat.startsWith(root)) ?? flat
}

export const markerFor = (postId: string, platform: string) => `cutter:${postId}:${platformRoot(platform)}`

/** A handle as it compares: "@Ziad.Moneytalks " and "ziad.moneytalks" alike. */
export function handleKey(handle: string | null | undefined): string {
  return (handle ?? '').trim().replace(/^@+/, '').toLowerCase().replace(/\s+/g, '')
}

/** Letters to change to turn one handle into the other. */
function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    row = next
  }
  return row[b.length]
}

/** Which of the campaign's accounts a cutter post went to: the one with its
 *  handle; one a letter or two off it ("Steven.ugcx" saved for
 *  "steve.ugcx"); or - with no handle saved to tell them apart - the only
 *  account on that platform (also when the cutter sent no handle). Never one with a different handle: matching on
 *  the platform alone ticked @danny.snoozed for videos that went to
 *  @lockinwithziad, and Jake's posts onto @hooksandmike. */
export function accountFor<A extends Pick<CampaignAccount, 'platform' | 'handle'>>(accounts: readonly A[], sent: CutterAccount): A | null {
  const root = platformRoot(sent.platform)
  const same = accounts.filter((a) => platformRoot(a.platform) === root)
  const keys = [handleKey(sent.profile), handleKey(sent.name)].filter(Boolean)
  // Nothing to tell accounts apart by (a function deployed before it sent
  // handles): only an account that is the one on its platform.
  if (keys.length === 0) return same.length === 1 ? same[0] : null
  const exact = same.filter((a) => keys.includes(handleKey(a.handle)))
  if (exact.length > 0) return exact.length === 1 ? exact[0] : null
  const near = same.filter((a) => {
    const saved = handleKey(a.handle)
    return saved.length >= 5 && keys.some((k) => k.length >= 5 && editDistance(k, saved) <= 2)
  })
  if (near.length === 1) return near[0]
  return same.length === 1 && !handleKey(same[0].handle) ? same[0] : null
}

/** The link to the video itself, when the cutter has one for this account -
 *  never the account's own page, which Postiz gives for TikTok and which is
 *  the same for every video it posts. Links are keyed by the account's name. */
export function videoLink(post: Pick<CutterPost, 'links'>, sent: CutterAccount): string | null {
  const link = post.links[sent.name] ?? Object.entries(post.links).find(([key]) => platformRoot(key) === platformRoot(sent.platform))?.[1]
  return link && /\/(video|reel|reels|p|shorts|posts?)\/|watch\?v=|youtu\.be\//i.test(link) ? link : null
}

/** The local calendar day an ISO instant falls on. */
function localDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return localToday()
  return d.toLocaleDateString('en-CA')
}

/** Accounts the cutter posts a linked campaign to that it doesn't have - so
 *  the Post screen can say so instead of ticking another account. */
export interface UnmatchedAccount {
  campaignId: string
  platform: string
  handle: string
  /** When the post that went there went out - the Post screen names only
   *  recent ones, so an account the campaign stopped posting to drops off. */
  at?: string
}

/** Which handles the cutter has posted each linked campaign to, per platform,
 *  over the last fortnight: `campaignId|platform root` -> handle -> when it
 *  was last posted to. Kept between passes by the caller. It is what tells a
 *  typo'd handle (the only account the cutter ever posts that campaign to on
 *  the platform) from another person's account (one of two it posts to). */
export type Roster = Record<string, Record<string, string>>

/** How far back the roster reaches. A rename is only ever made from a roster
 *  that covers this long: a device that has only seen this morning's posts
 *  could take one creator's account for the campaign's only one. */
export const ROSTER_DAYS = 14

export function rosterKey(campaignId: string, platform: string): string {
  return `${campaignId}|${platformRoot(platform)}`
}

/** Drops what is older than the fortnight. */
export function pruneRoster(roster: Roster, now = Date.now()): Roster {
  const since = now - ROSTER_DAYS * 24 * 60 * 60 * 1000
  const out: Roster = {}
  for (const [key, handles] of Object.entries(roster)) {
    const kept = Object.fromEntries(Object.entries(handles).filter(([, at]) => Date.parse(at) >= since))
    if (Object.keys(kept).length > 0) out[key] = kept
  }
  return out
}

/** An account the pass added to a campaign, or whose handle it put right. */
export interface AccountChange {
  campaignId: string
  platform: string
  handle: string
  /** The handle it had before a correction; absent for an addition or an
   *  empty handle filled in. */
  from?: string | null
  at: string
}

export interface ApplyOutcome {
  ticked: number
  /** Accounts the cutter posts a campaign to that are not its accounts here
   *  - another person's, on a platform the campaign already has an account
   *  for - so nothing is ticked and nothing is changed. */
  unmatched: UnmatchedAccount[]
  added: AccountChange[]
  renamed: AccountChange[]
}

/** Ticks what the cutter posted: each post one deliverable, its accounts in
 *  ONE column (a post to TikTok and Instagram is the same video in both),
 *  on the day it went out, on the accounts it really went to.
 *
 *  The cutter is where posts really go, so what it says about a campaign's
 *  accounts is taken rather than asked for: an account on a platform the
 *  campaign has none for is added (ready - it is being posted to); an
 *  account saved with no handle gets the cutter's; and a handle a few
 *  letters off the only one the cutter ever posts that campaign to on the
 *  platform is corrected ("studywithmike1" for @studywithmichael1). Only a
 *  post to a different account on a platform the campaign already has one
 *  for is left alone and named - Jake's posts are not Mike's. `roster` is
 *  the fortnight's handles (see Roster); `complete` says it covers the whole
 *  fortnight, without which no handle is corrected. */
export async function applyCutterPosts(
  data: DataAdapter,
  posts: readonly CutterPost[],
  roster: Roster = {},
  complete = false,
): Promise<ApplyOutcome> {
  let ticked = 0
  const unmatched: UnmatchedAccount[] = []
  const added: AccountChange[] = []
  const renamed: AccountChange[] = []
  for (const post of posts) {
    const campaigns = await data.listCampaigns()
    const campaign = campaigns.find((c) => c.cutter_campaign_id === post.campaignId)
    if (!campaign) continue
    for (const sent of post.accounts) {
      const handle = handleKey(sent.profile)
      if (handle === '') continue
      const key = rosterKey(campaign.id, sent.platform)
      const seen = roster[key] ?? (roster[key] = {})
      if (!seen[handle] || seen[handle] < post.postedAt) seen[handle] = post.postedAt
    }
    const date = localDay(post.postedAt)
    const boardNow = async (): Promise<PostingBoard | undefined> => {
      const [accounts, videos, existing] = await Promise.all([data.listCampaignAccounts(), data.listVideos(), data.listAllVideoPosts()])
      return boardsForToday(campaigns, accounts, videos, existing, date).find((b) => b.campaign.id === campaign.id)
    }
    for (const sent of post.accounts) {
      const marker = markerFor(post.id, sent.platform)
      const link = videoLink(post, sent)
      const views = post.views?.[sent.name]
      const existing = await data.listAllVideoPosts()
      const done = existing.find((p) => p.url === marker || (link !== null && p.url === link))
      if (done && localDay(done.posted_at) === date) {
        // Ticked already: its views, as they come in.
        if (typeof views === 'number' && done.view_count !== views) await data.setViewCount(done.id, views)
        continue
      }
      if (done) {
        // Ticked on another day - by an earlier version, on the day it was
        // ticked rather than the day it went out (October 15th's video
        // counted on the 19th). Taken off that day, ticked on its own below.
        const owner = (await data.listCampaignAccounts()).find((a) => a.id === done.account_id)
        if (!owner) continue
        await unmarkPosted(data, owner, done, { correction: true })
      }
      let board = await boardNow()
      if (!board) break
      let here = board.rows.map((r) => r.account)
      let account = accountFor(here, sent)
      if (!account) {
        const root = platformRoot(sent.platform)
        const onPlatform = here.filter((a) => platformRoot(a.platform) === root)
        const profile = (sent.profile ?? '').trim().replace(/^@+/, '')
        const everSeen = Object.keys(roster[rosterKey(campaign.id, sent.platform)] ?? {})
        if (onPlatform.length === 0) {
          // A platform the campaign has no account for: the cutter posts
          // there, so it gets one.
          await data.addCampaignAccount({
            campaign_id: campaign.id,
            platform: PLATFORM_NAMES[root] ?? sent.platform,
            handle: profile === '' ? null : profile,
            status: 'ready',
            sort_order: here.length,
          })
          added.push({ campaignId: campaign.id, platform: PLATFORM_NAMES[root] ?? sent.platform, handle: profile, at: post.postedAt })
        } else if (onPlatform.length === 1 && profile !== '' && complete && everSeen.length === 1) {
          // The only account the cutter ever posts this campaign to on the
          // platform, saved here under a handle a few letters off: the
          // cutter's is the real one.
          await data.updateCampaignAccount(onPlatform[0].id, { handle: profile })
          renamed.push({ campaignId: campaign.id, platform: onPlatform[0].platform, handle: profile, from: onPlatform[0].handle, at: post.postedAt })
        } else {
          unmatched.push({ campaignId: campaign.id, platform: sent.platform, handle: sent.profile || sent.name, at: post.postedAt })
          continue
        }
        board = await boardNow()
        if (!board) break
        here = board.rows.map((r) => r.account)
        account = accountFor(here, sent)
        if (!account) continue
      } else if (!handleKey(account.handle) && (sent.profile ?? '').trim() !== '') {
        // Matched as the one account on its platform with no handle saved:
        // the cutter knows the handle, so it is filled in.
        const profile = sent.profile!.trim().replace(/^@+/, '')
        await data.updateCampaignAccount(account.id, { handle: profile })
        renamed.push({ campaignId: campaign.id, platform: account.platform, handle: profile, from: null, at: post.postedAt })
        account = { ...account, handle: profile }
      }
      // The column this post already holds (another of its accounts was
      // ticked that day). Only a tick with a url can be one of its own: a box
      // he ticked by hand has none, and so does an account with no link here
      // - null matching null once sent each account of a post to a column of
      // its own ("8 of 2 today").
      const mine = existing.find(
        (p) =>
          p.url !== null &&
          localDay(p.posted_at) === date &&
          (p.url.startsWith(`cutter:${post.id}:`) || post.accounts.some((a) => videoLink(post, a) === p.url)),
      )
      const targets = new Set(post.accounts.map((a) => accountFor(here, a)?.id).filter((id): id is string => Boolean(id)))
      const held = mine ? board.videoIdBySlot.indexOf(mine.video_id) : -1
      // Else a column he ticked by hand for it; else the first open on every
      // account it went to; else a new one.
      const slot = held >= 0 ? held : handColumn(board, targets, post.postedAt)
      const tick = { url: link ?? marker, posted_at: post.postedAt, view_count: null, view_count_entered_at: null }
      if (slot >= 0) await claim(data, board.videoIdBySlot[slot]!, account, tick)
      else {
        const open = Array.from({ length: board.slots }, (_, s) => s).find((s) =>
          board.rows.filter((r) => targets.has(r.account.id)).every((r) => r.cells[s]?.post === null),
        )
        await markPosted(data, board, account, open ?? board.slots, await data.listVideos(), date, tick.url, post.postedAt)
      }
      ticked++
      if (typeof views === 'number') {
        const made = (await data.listAllVideoPosts()).find((p) => p.url === tick.url)
        if (made) await data.setViewCount(made.id, views)
      }
    }
  }
  return { ticked, unmatched, added, renamed }
}

/** When the bridge's corrections took the money off the day they were made
 *  instead of the day it was wrongly counted on - before removeVideoPost's
 *  `correction` - so "today" showed money taken off for other days' videos:
 *  "why does it say negative money now". */
const MISDATED = { from: Date.parse('2026-10-19T17:00:00Z'), until: Date.parse('2026-10-20T12:00:00Z') }

/** Moves those reversals onto the days of the checkoffs they undo
 *  (redateReversal). Does nothing once done, so it runs on every pass.
 *  Returns how many it moved. */
export async function redateCorrections(data: DataAdapter): Promise<number> {
  const events = await data.listEarningsEvents()
  const byId = new Map(events.map((e) => [e.id, e]))
  let moved = 0
  for (const event of events) {
    if (event.source !== 'reversal' || event.reverses_id === null) continue
    const at = instant(event.occurred_at)
    if (!(at >= MISDATED.from && at < MISDATED.until)) continue
    const original = byId.get(event.reverses_id)
    if (!original || original.earned_on === event.earned_on) continue
    if (await data.redateReversal(event.id)) moved++
  }
  return moved
}

type Tick = Pick<VideoPost, 'url' | 'posted_at' | 'view_count' | 'view_count_entered_at'>

/** A column he ticked by hand on every account a cutter post went to, before
 *  it went out, with no cutter tick in it: he ticked the boxes for the video
 *  as he sent it (Vertus, ticked at 12:33, posted at 3:24 and 5:32), so the
 *  post is that column, not one more. -1 for none. */
function handColumn(board: PostingBoard, targets: ReadonlySet<string>, postedAt: string): number {
  if (targets.size === 0) return -1
  return board.videoIdBySlot.findIndex((videoId, slot) => {
    if (videoId === null) return false
    const ticks = board.rows.map((r) => r.cells[slot]?.post ?? null).filter((p): p is VideoPost => p !== null)
    return isHandColumn(ticks, targets, postedAt)
  })
}

/** Ticked by hand on exactly these accounts, each before `postedAt`. */
function isHandColumn(ticks: readonly VideoPost[], targets: ReadonlySet<string>, postedAt: string): boolean {
  return (
    ticks.length === targets.size &&
    ticks.every((p) => p.url === null && p.account_id !== null && targets.has(p.account_id) && instant(p.posted_at) <= instant(postedAt))
  )
}

/** An ISO time as a number: the cutter's "+00:00" and a local "Z" alike. */
const instant = (iso: string) => Date.parse(iso)

/** Puts a cutter tick for `account` on `videoId`: a box there he ticked by
 *  hand becomes it, with the post's link and the time it went out. A tick
 *  there that is already a post's is left alone. */
async function claim(data: DataAdapter, videoId: string, account: CampaignAccount, tick: Tick): Promise<void> {
  const there = (await data.listVideoPosts(videoId)).find((p) => p.account_id === account.id)
  if (there && there.url !== null) return
  if (there) await data.removeVideoPost(videoId, account.id, { correction: true })
  await data.addVideoPost({
    video_id: videoId,
    account_id: account.id,
    platform: account.platform,
    url: tick.url,
    posted_at: tick.posted_at,
    view_count: tick.view_count ?? there?.view_count ?? null,
    view_count_entered_at: tick.view_count_entered_at ?? there?.view_count_entered_at ?? null,
  })
  const video = await data.getVideo(videoId)
  if (video !== null && video.phase !== 'posted') await data.markVideoPosted(videoId, { session: 'post' })
}

/** The columns he ticked by hand for a video the cutter then posted, joined
 *  to the cutter's: its ticks go onto his column (which keeps its place) and
 *  its own video goes back. Same rule as handColumn - the same accounts, the
 *  same day, ticked by hand before it went out - each hand column taken by
 *  one post at most. For the doubles an earlier version left ("4 of 2");
 *  does nothing once there are none. Returns how many ticks moved. */
export async function joinHandColumns(data: DataAdapter, days = 7): Promise<number> {
  const [campaigns, accounts, videos, posts] = await Promise.all([
    data.listCampaigns(),
    data.listCampaignAccounts(),
    data.listVideos(),
    data.listAllVideoPosts(),
  ])
  const linked = new Set(campaigns.filter((c) => c.cutter_campaign_id).map((c) => c.id))
  const videoById = new Map(videos.map((v) => [v.id, v]))
  const since = Date.now() - days * 24 * 60 * 60 * 1000
  const dates = new Set(
    posts
      .filter((p) => p.url !== null && instant(p.posted_at) >= since && linked.has(videoById.get(p.video_id)?.campaign_id ?? ''))
      .map((p) => localDay(p.posted_at)),
  )
  let moved = 0
  for (const date of dates) {
    for (const board of boardsForToday(campaigns, accounts, videos, posts, date)) {
      if (!linked.has(board.campaign.id)) continue
      const column = (slot: number) => board.rows.map((r) => r.cells[slot]?.post ?? null).filter((p): p is VideoPost => p !== null)
      const slots = board.videoIdBySlot.map((_, slot) => slot)
      const cutter = slots.filter((s) => column(s).length > 0 && column(s).every((p) => p.url !== null))
      const taken = new Set<number>()
      for (const from of cutter) {
        const ticks = column(from)
        const first = ticks.reduce((a, p) => (instant(p.posted_at) < instant(a) ? p.posted_at : a), ticks[0].posted_at)
        const targets = new Set(ticks.map((p) => p.account_id).filter((id): id is string => id !== null))
        const to = slots.find((s) => !taken.has(s) && s !== from && isHandColumn(column(s), targets, first))
        if (to === undefined) continue
        taken.add(to)
        for (const tick of ticks) {
          const account = accounts.find((a) => a.id === tick.account_id)
          if (!account) continue
          await claim(data, board.videoIdBySlot[to]!, account, tick)
          await unmarkPosted(data, account, tick, { correction: true })
          moved++
        }
      }
    }
  }
  return moved
}

/** Puts back together a cutter post an earlier pass spread over several
 *  columns: each account's tick on a video of its own, so one post to three
 *  accounts read as three deliverables. A post's ticks are the ones with a
 *  url (never a box ticked by hand) on the same campaign at the same instant
 *  - every account of one post is ticked with the post's own time - each
 *  account once. They go onto the video holding most of them (then the one owed
 *  that day, then the oldest) through the same untick and tick as by hand,
 *  so the earnings history and the videos sent back to the backlog follow.
 *  Does nothing once nothing is split, so it runs on every pass. Returns how
 *  many ticks moved. */
export async function mergeSplitPosts(data: DataAdapter): Promise<number> {
  const [posts, videos, accounts] = await Promise.all([data.listAllVideoPosts(), data.listVideos(), data.listCampaignAccounts()])
  const videoById = new Map(videos.map((v) => [v.id, v]))
  const groups = new Map<string, VideoPost[]>()
  for (const tick of posts) {
    const video = videoById.get(tick.video_id)
    if (tick.url === null || tick.account_id === null || !video) continue
    const key = `${video.campaign_id}|${instant(tick.posted_at)}`
    groups.set(key, [...(groups.get(key) ?? []), tick])
  }
  let moved = 0
  for (const group of groups.values()) {
    const ids = [...new Set(group.map((p) => p.video_id))]
    if (ids.length < 2) continue
    // Two posts can share a time (one scheduled at 13:31:00 sharp, like
    // another): an account ticked twice, or two posts' markers, is two
    // posts, never one to put together.
    const accountIds = group.map((p) => p.account_id)
    const postIds = new Set(group.map((p) => (p.url?.startsWith('cutter:') ? p.url.split(':')[1] : null)).filter(Boolean))
    if (new Set(accountIds).size < accountIds.length || postIds.size > 1) continue
    const held = (id: string) => group.filter((p) => p.video_id === id).length
    const day = localToday(new Date(group[0].posted_at))
    const owed = (id: string) => (videoById.get(id)?.owed_for_date === day ? 1 : 0)
    const created = (id: string) => videoById.get(id)?.created_at ?? ''
    const [keep] = ids.sort((a, b) => held(b) - held(a) || owed(b) - owed(a) || created(a).localeCompare(created(b)))
    const there = new Set(posts.filter((p) => p.video_id === keep).map((p) => p.account_id))
    for (const tick of group) {
      if (tick.video_id === keep) continue
      const account = accounts.find((a) => a.id === tick.account_id)
      if (!account) continue
      await unmarkPosted(data, account, tick, { correction: true })
      if (there.has(account.id)) continue
      await data.addVideoPost({
        video_id: keep,
        account_id: account.id,
        platform: tick.platform,
        url: tick.url,
        posted_at: tick.posted_at,
        view_count: tick.view_count,
        view_count_entered_at: tick.view_count_entered_at,
      })
      there.add(account.id)
      moved++
    }
  }
  return moved
}

/** A video waiting in Postiz for its time, as the cutter reports it. */
export interface CutterScheduled {
  id: string
  campaignId: string
  /** Absent from a function deployed before it was added. */
  campaignName?: string
  platforms: string[]
  /** The accounts it goes to, with their handles - absent from a function
   *  deployed before they were sent (then only `platforms`). */
  accounts?: CutterAccount[]
  postAt: string
}

/** How many of a day's boxes are scheduled in the cutter, per planner
 *  account - the account each post will really go to (accountFor), not the
 *  first one on its platform - and the accounts a campaign doesn't have.
 *  Only ever painted, never ticked: the box ticks itself when the post
 *  actually goes out (applyCutterPosts). Only linked campaigns, only that
 *  day's posts. */
export function scheduledByAccount(
  posts: readonly CutterScheduled[],
  boards: readonly Pick<PostingBoard, 'campaign' | 'rows'>[],
  date: string,
): { counts: Map<string, number>; unmatched: UnmatchedAccount[] } {
  const counts = new Map<string, number>()
  const unmatched: UnmatchedAccount[] = []
  for (const post of posts) {
    if (localDay(post.postAt) !== date) continue
    const board = boards.find((b) => b.campaign.cutter_campaign_id === post.campaignId)
    if (!board) continue
    const here = board.rows.map((r) => r.account)
    for (const sent of post.accounts ?? post.platforms.map((platform): CutterAccount => ({ name: '', platform }))) {
      const account = accountFor(here, sent)
      if (account) counts.set(account.id, (counts.get(account.id) ?? 0) + 1)
      else if (sent.profile || sent.name) unmatched.push({ campaignId: board.campaign.id, platform: sent.platform, handle: sent.profile || sent.name })
    }
  }
  return { counts, unmatched }
}

/** "TikTok @lockinwithziad", once each - the accounts to name under a
 *  campaign the cutter posts to but that it doesn't have. */
export function unmatchedLabels(unmatched: readonly UnmatchedAccount[], campaignId: string): string[] {
  const labels = unmatched
    .filter((u) => u.campaignId === campaignId)
    .map((u) => `${PLATFORM_NAMES[platformRoot(u.platform)] ?? u.platform} @${handleKey(u.handle)}`)
  return [...new Set(labels)]
}

/** "Pump.Fun" and "pump.fun" alike: lowercase, letters and digits only. */
function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export interface LinkSuggestion {
  campaignId: string
  campaignName: string
  cutterId: string
  cutterName: string
}

/** Planner campaigns the cutter has one with the same name: a suggestion
 *  only, which he confirms with a tap - the bridge never links on a name by
 *  itself. Exact names first; otherwise one name starting with the other
 *  ("Lock in App", "Lock in"), and only when that is the one candidate.
 *  Leaves out what is already linked, archived, or he said is not a match. */
export function suggestCutterLinks(
  campaigns: readonly { id: string; name: string; cutter_campaign_id: string | null; archived_at?: string | null }[],
  cutter: readonly { id: string; name: string }[],
  dismissed: ReadonlySet<string> = new Set(),
): LinkSuggestion[] {
  const taken = new Set(campaigns.map((c) => c.cutter_campaign_id).filter(Boolean))
  const free = cutter.filter((c) => !taken.has(c.id))
  const out: LinkSuggestion[] = []
  const used = new Set<string>()
  for (const campaign of campaigns) {
    if (campaign.cutter_campaign_id || campaign.archived_at) continue
    const key = nameKey(campaign.name)
    if (key.length === 0) continue
    const open = free.filter((c) => !used.has(c.id) && !dismissed.has(`${campaign.id}:${c.id}`))
    const exact = open.filter((c) => nameKey(c.name) === key)
    const near = open.filter((c) => {
      const other = nameKey(c.name)
      const shorter = Math.min(other.length, key.length)
      return other !== key && shorter >= 4 && (other.startsWith(key) || key.startsWith(other))
    })
    const pick = exact.length === 1 ? exact[0] : exact.length === 0 && near.length === 1 ? near[0] : null
    if (!pick) continue
    used.add(pick.id)
    out.push({ campaignId: campaign.id, campaignName: campaign.name, cutterId: pick.id, cutterName: pick.name })
  }
  return out
}
