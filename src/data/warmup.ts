// Whether a campaign's account still needs warming up.
//
// "Warmed up twice" is a count taken from warmup_events at query time, never a
// mutable number on the campaign row - see docs/schema.sql. A campaign that
// has ever actually posted, including posts carried over from before the app
// existed, plainly already has a live account: warm-up is only ever a
// question for one that has not.

import type { Campaign, Video, WarmupEvent } from './schema'

export const WARMUP_SESSIONS_REQUIRED = 2

export function warmupCompletions(
  campaignId: string,
  events: readonly WarmupEvent[],
): number {
  return events.filter((e) => e.campaign_id === campaignId).length
}

export function needsWarmup(
  campaign: Campaign,
  videos: readonly Video[],
  events: readonly WarmupEvent[],
): boolean {
  if (campaign.opening_post_count > 0) return false
  if (videos.some((v) => v.campaign_id === campaign.id && v.phase === 'posted')) return false
  return warmupCompletions(campaign.id, events) < WARMUP_SESSIONS_REQUIRED
}
