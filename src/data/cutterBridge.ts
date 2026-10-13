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
import { boardsForToday, markPosted } from './posting'

export interface CutterPost {
  id: string
  campaignId: string
  campaignName: string
  accounts: { name: string; platform: string }[]
  links: Record<string, string>
  postedAt: string
}

const ROOTS = ['tiktok', 'instagram', 'youtube', 'facebook', 'twitter', 'linkedin', 'threads', 'pinterest']

/** "tiktok-business" and "TikTok" are both "tiktok". Unknown names stay as
 *  they are, letters only. */
export function platformRoot(platform: string): string {
  const flat = platform.toLowerCase().replace(/[^a-z0-9]/g, '')
  return ROOTS.find((root) => flat.startsWith(root)) ?? flat
}

export const markerFor = (postId: string, platform: string) => `cutter:${postId}:${platformRoot(platform)}`

/** The local calendar day an ISO instant falls on. */
function localDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return localToday()
  return d.toLocaleDateString('en-CA')
}

/** Ticks what the cutter posted. Returns how many boxes it ticked. */
export async function applyCutterPosts(data: DataAdapter, posts: readonly CutterPost[]): Promise<number> {
  let ticked = 0
  for (const post of posts) {
    const campaigns = await data.listCampaigns()
    const campaign = campaigns.find((c) => c.cutter_campaign_id === post.campaignId)
    if (!campaign) continue
    const date = localDay(post.postedAt)
    for (const sent of post.accounts) {
      const root = platformRoot(sent.platform)
      const marker = markerFor(post.id, sent.platform)
      const link = Object.entries(post.links).find(([key]) => platformRoot(key) === root)?.[1] ?? null
      const [accounts, videos, existing] = await Promise.all([
        data.listCampaignAccounts(),
        data.listVideos(),
        data.listAllVideoPosts(),
      ])
      if (existing.some((p) => p.url === marker || (link !== null && p.url === link))) continue
      const board = boardsForToday(campaigns, accounts, videos, existing, date).find((b) => b.campaign.id === campaign.id)
      const row = board?.rows.find((r) => r.account.is_active && platformRoot(r.account.platform) === root)
      if (!board || !row) continue
      const open = row.cells.find((cell) => cell.post === null)
      await markPosted(data, board, row.account, open ? open.slot : board.slots, videos, date, link ?? marker)
      ticked++
    }
  }
  return ticked
}

/** A video waiting in Postiz for its time, as the cutter reports it. */
export interface CutterScheduled {
  id: string
  campaignId: string
  /** Absent from a function deployed before it was added. */
  campaignName?: string
  platforms: string[]
  postAt: string
}

/** How many of a day's boxes are scheduled in the cutter, per planner
 *  campaign and platform: "Inflow, TikTok: 2". Only ever painted, never
 *  ticked - the box ticks itself when the post actually goes out
 *  (applyCutterPosts). Only linked campaigns, only that day's posts. */
export function scheduledCounts(
  posts: readonly CutterScheduled[],
  campaigns: readonly { id: string; cutter_campaign_id: string | null }[],
  date: string,
): Map<string, Map<string, number>> {
  const counts = new Map<string, Map<string, number>>()
  for (const post of posts) {
    if (localDay(post.postAt) !== date) continue
    const campaign = campaigns.find((c) => c.cutter_campaign_id === post.campaignId)
    if (!campaign) continue
    const byPlatform = counts.get(campaign.id) ?? new Map<string, number>()
    for (const root of new Set(post.platforms.map(platformRoot))) byPlatform.set(root, (byPlatform.get(root) ?? 0) + 1)
    counts.set(campaign.id, byPlatform)
  }
  return counts
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
