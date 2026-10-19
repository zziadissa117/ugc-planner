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
import { boardsForToday, markPosted, type PostingBoard } from './posting'
import type { CampaignAccount } from './schema'

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
}

/** Ticks what the cutter posted: each post one deliverable, its accounts in
 *  ONE column (a post to TikTok and Instagram is the same video in both),
 *  on the day it went out, on the accounts it really went to. Returns how
 *  many boxes it ticked, and the accounts it couldn't find in the campaign. */
export async function applyCutterPosts(
  data: DataAdapter,
  posts: readonly CutterPost[],
): Promise<{ ticked: number; unmatched: UnmatchedAccount[] }> {
  let ticked = 0
  const unmatched: UnmatchedAccount[] = []
  for (const post of posts) {
    const campaigns = await data.listCampaigns()
    const campaign = campaigns.find((c) => c.cutter_campaign_id === post.campaignId)
    if (!campaign) continue
    const date = localDay(post.postedAt)
    const boardNow = async (): Promise<PostingBoard | undefined> => {
      const [accounts, videos, existing] = await Promise.all([data.listCampaignAccounts(), data.listVideos(), data.listAllVideoPosts()])
      return boardsForToday(campaigns, accounts, videos, existing, date).find((b) => b.campaign.id === campaign.id)
    }
    for (const sent of post.accounts) {
      const marker = markerFor(post.id, sent.platform)
      const link = videoLink(post, sent)
      const existing = await data.listAllVideoPosts()
      if (existing.some((p) => p.url === marker || (link !== null && p.url === link))) continue
      const board = await boardNow()
      if (!board) break
      const here = board.rows.map((r) => r.account)
      const account = accountFor(here, sent)
      if (!account) {
        unmatched.push({ campaignId: campaign.id, platform: sent.platform, handle: sent.profile || sent.name })
        continue
      }
      // The column this post already holds (another of its accounts was
      // ticked); else the first open on every account it went to; else a
      // new one.
      const mine = existing.find((p) => p.url?.startsWith(`cutter:${post.id}:`) || post.accounts.some((a) => videoLink(post, a) === p.url))
      const held = mine ? board.videoIdBySlot.indexOf(mine.video_id) : -1
      const targets = new Set(post.accounts.map((a) => accountFor(here, a)?.id).filter(Boolean))
      const open = Array.from({ length: board.slots }, (_, slot) => slot).find((slot) =>
        board.rows.filter((r) => targets.has(r.account.id)).every((r) => r.cells[slot]?.post === null),
      )
      const slot = held >= 0 ? held : (open ?? board.slots)
      await markPosted(data, board, account, slot, await data.listVideos(), date, link ?? marker, post.postedAt)
      ticked++
    }
  }
  return { ticked, unmatched }
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
