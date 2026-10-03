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
