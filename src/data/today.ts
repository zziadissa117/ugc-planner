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
import type { Campaign, CampaignAccount, Video } from './schema'

/** Creates the video rows owed for `date` that do not exist yet, one per unit
 *  of each active campaign's daily quota.
 *
 *  The quota resets at midnight; videos mid-pipeline do not. A filmed video
 *  does not evaporate because the date changed, so this only ever adds the
 *  rows that are missing for the day and never touches anything already in
 *  flight.
 *
 *  Returns how many rows it created. */
/** Videos a campaign owes per day: the MAX of posts_per_day across the
 *  accounts that are ready to post, never the sum.
 *
 *  One video is cross-posted to every account and is still one deliverable -
 *  contractual for Inflow, and what he described for Vertus ("2 on yt 2 on ig"
 *  is two videos, each going to both). Summing would double the work.
 *
 *  Only `ready` accounts count. A campaign still warming up raises no daily
 *  obligation: it belongs on the warm-up screen, not in the day's quota.
 *
 *  Falls back to campaigns.daily_post_quota while a campaign has no accounts
 *  yet, so a device that has not run the v4 derivation still owes what it did
 *  before. That column is otherwise no longer read. */
export function dailyVideoDemand(
  campaign: Campaign,
  accounts: readonly CampaignAccount[],
): number {
  const mine = accounts.filter(
    (account) => account.campaign_id === campaign.id && account.is_active,
  )
  if (mine.length === 0) return campaign.daily_post_quota

  const ready = mine.filter((account) => account.status === 'ready')
  return ready.reduce((most, account) => Math.max(most, account.posts_per_day), 0)
}

export async function ensureTodaysQuota(
  adapter: DataAdapter,
  date: string = localToday(),
): Promise<number> {
  const campaigns = await adapter.listCampaigns()
  const accounts = await adapter.listCampaignAccounts()
  let created = 0

  for (const campaign of campaigns) {
    const demand = dailyVideoDemand(campaign, accounts)
    if (demand <= 0) continue

    const existing = await adapter.listVideos({ campaignId: campaign.id, owedForDate: date })
    const missing = demand - existing.length

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
  accounts: readonly CampaignAccount[] = [],
): TodaySummary {
  const owed = campaigns.reduce((sum, c) => sum + dailyVideoDemand(c, accounts), 0)

  // Counted by when the post actually happened, not by the day it was owed
  // for: posting today clears today's obligation even if the row was raised
  // yesterday.
  //
  // `posted_at` is stored as a UTC ISO timestamp, and `date` is a LOCAL
  // calendar day (from localToday()). Slicing the ISO string used to compare
  // a UTC date against a local one directly - they agree only when the two
  // happen to be on the same calendar day, which is false for hours every
  // evening in any timezone west of UTC. A video posted five minutes ago
  // would silently not count as posted "today" until well past local
  // midnight. Parsing it back through localToday() compares local day to
  // local day, which is the only comparison that means what it says.
  const posted = videos.filter(
    (v) => v.phase === 'posted' && v.posted_at !== null && localToday(new Date(v.posted_at)) === date,
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
