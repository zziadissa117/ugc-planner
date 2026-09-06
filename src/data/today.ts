// Today's obligation, and what is banked against it.
//
// SPEC section 3: a task is one video, not a campaign. A campaign with a quota
// of 2 produces two independent tasks, so video 1 can be ticked off while
// video 2 is still outstanding - never a per-campaign counter.
//
// So the daily quota has to exist as rows, not as a number computed on the
// fly. These are derived from each campaign's own daily_post_quota, which came
// from the user or a document; nothing here invents an obligation.

import type { DataAdapter } from './DataAdapter'
import { localToday } from './index'
import type { Campaign, Video } from './schema'

/** Creates the video rows owed for `date` that do not exist yet, one per unit
 *  of each active campaign's daily quota.
 *
 *  The quota resets at midnight; videos mid-pipeline do not. A filmed video
 *  does not evaporate because the date changed, so this only ever adds the
 *  rows that are missing for the day and never touches anything already in
 *  flight.
 *
 *  Returns how many rows it created. */
export async function ensureTodaysQuota(
  adapter: DataAdapter,
  date: string = localToday(),
): Promise<number> {
  const campaigns = await adapter.listCampaigns()
  let created = 0

  for (const campaign of campaigns) {
    if (campaign.daily_post_quota <= 0) continue

    const existing = await adapter.listVideos({ campaignId: campaign.id, owedForDate: date })
    const missing = campaign.daily_post_quota - existing.length

    for (let i = 0; i < missing; i++) {
      await adapter.createVideo({
        campaign_id: campaign.id,
        // Contracted: this is work the campaign's quota actually owes.
        kind: 'contracted',
        setup: campaign.default_setup,
        angle_id: null,
        script: null,
        blocked_reason: null,
        owed_for_date: date,
        rate_snapshot_cents: null,
        posted_at: null,
      })
      created++
    }
  }

  return created
}

export interface TodaySummary {
  /** Posts made today. */
  posted: number
  /** Posts owed today, summed across active campaigns. */
  owed: number
  /** Videos edited and unposted - supply already banked, ready to go out.
   *  This counted `approved` until that phase was removed; nothing could ever
   *  reach it, so runway was permanently 0. */
  postReadyCount: number
  /** Days of posting banked: ready stock divided by the daily obligation.
   *  Null when nothing is owed daily, because "days of posts" means nothing
   *  without a per-day figure to divide by. */
  runwayDays: number | null
  /** Videos filmed but not yet edited. The usual binding constraint. */
  editBacklog: number
}

export function summariseToday(
  campaigns: readonly Campaign[],
  videos: readonly Video[],
  date: string = localToday(),
): TodaySummary {
  const owed = campaigns.reduce((sum, c) => sum + c.daily_post_quota, 0)

  // Counted by when the post actually happened, not by the day it was owed
  // for: posting today clears today's obligation even if the row was raised
  // yesterday.
  const posted = videos.filter(
    (v) => v.phase === 'posted' && v.posted_at !== null && v.posted_at.slice(0, 10) === date,
  ).length

  const postReadyCount = videos.filter((v) => v.phase === 'edited').length
  const editBacklog = videos.filter((v) => v.phase === 'filmed').length

  return {
    posted,
    owed,
    postReadyCount,
    runwayDays: owed > 0 ? Math.floor(postReadyCount / owed) : null,
    editBacklog,
  }
}

/** Under three days banked with a non-empty edit backlog, nudge toward an EDIT
 *  session. One line of text, per SPEC section 2 - never a modal. */
export function shouldNudgeToEdit(summary: TodaySummary): boolean {
  return summary.runwayDays !== null && summary.runwayDays < 3 && summary.editBacklog > 0
}
