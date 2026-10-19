// How a campaign's posted videos stand against its minimum views
// (campaigns.min_views): "8 of 12 posted reached 1,000 views".
//
// A video counts once ANY one account it went to reaches the minimum - he
// chose that over adding the accounts' views together. Views come from the
// cutter, which reads each posted video's views from the platforms a day,
// three days and a week after it went out (its postViews.ts), and the bridge
// writes them onto the ticks (video_posts.view_count). A video the cutter
// never posted has none unless typed, and reads as "not read yet".
//
// It changes the count only, never what a video earns: he chose that too.

import type { Video, VideoPost } from './schema'

export interface ViewsTally {
  /** Posted videos of the campaign. */
  posted: number
  /** Of those, the ones with an account at or over the minimum. */
  reached: number
  /** Read, and still under it on every account. */
  under: number
  /** No views known for any of its accounts yet. */
  unread: number
}

export function viewsTally(
  campaignId: string,
  minViews: number,
  videos: readonly Pick<Video, 'id' | 'campaign_id' | 'phase'>[],
  posts: readonly Pick<VideoPost, 'video_id' | 'view_count'>[],
): ViewsTally {
  const tally: ViewsTally = { posted: 0, reached: 0, under: 0, unread: 0 }
  const best = new Map<string, number>()
  for (const post of posts) {
    if (post.view_count === null) continue
    best.set(post.video_id, Math.max(best.get(post.video_id) ?? 0, post.view_count))
  }
  for (const video of videos) {
    if (video.campaign_id !== campaignId || video.phase !== 'posted') continue
    tally.posted++
    const views = best.get(video.id)
    if (views === undefined) tally.unread++
    else if (views >= minViews) tally.reached++
    else tally.under++
  }
  return tally
}

/** "1,000", "1.2K", "15K", "1.5M" - a minimum as he'd say it. */
export function formatViews(views: number): string {
  if (views >= 1_000_000) return `${Number((views / 1_000_000).toFixed(1))}M`
  if (views >= 10_000) return `${Math.round(views / 1000)}K`
  return views.toLocaleString('en-US')
}

/** A typed minimum - "1000", "1,000", "1k", "1.5K", "2m" - or null for none
 *  or anything that isn't one. */
export function parseViews(raw: string): number | null {
  const text = raw.trim().toLowerCase().replace(/[,\s]/g, '')
  const match = /^(\d+(?:\.\d+)?)([km])?$/.exec(text)
  if (!match) return null
  const n = Math.round(Number(match[1]) * (match[2] === 'm' ? 1_000_000 : match[2] === 'k' ? 1000 : 1))
  return Number.isSafeInteger(n) && n > 0 ? n : null
}
