// Today's obligation, and what has been done against it.
//
// The one rule this file exists to hold: a campaign's daily obligation is a
// number on the CAMPAIGN, and the platforms it posts to are destinations for
// that obligation - never a multiplier on it.
//
// It briefly worked the other way round: demand was read as the maximum
// posts_per_day across a campaign's accounts, which meant the account list
// silently decided how much work was owed, and adding a third platform to a
// campaign that owes one video a day could change the arithmetic underneath
// both the obligation and the money. `campaigns.daily_post_quota` is the
// single source of truth, and nothing derives a quota from the account list.

import type { DataAdapter } from './DataAdapter'
import { localToday } from './index'
import { boardsForToday, tallyBoards } from './posting'
import type { Campaign, CampaignAccount, Video, VideoPost } from './schema'

/** Paid deliverables this campaign owes per day.
 *
 *  One video cross-posted to Instagram, TikTok and YouTube is ONE deliverable
 *  - Inflow's contract says so and he confirmed the same for the others - so
 *  this never looks at how many accounts the campaign has. */
export function dailyVideoDemand(campaign: Campaign): number {
  return campaign.daily_post_quota
}

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
    const demand = dailyVideoDemand(campaign)
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

/** Deliverables that actually went out on `date`, across all campaigns.
 *
 *  Counted from video_posts - the row written when a platform is ticked -
 *  and de-duplicated by video, because one deliverable posted to three
 *  platforms is one deliverable done, not three. Counting phase changes
 *  instead is what produced "19 of 6 posted": a backlog of old videos being
 *  marked posted in one sitting all landed on the same day and inflated the
 *  numerator past the day's actual obligation. */
export function deliverablesPostedOn(
  posts: readonly VideoPost[],
  date: string = localToday(),
): Set<string> {
  const videoIds = new Set<string>()
  for (const post of posts) {
    if (localToday(new Date(post.posted_at)) === date) videoIds.add(post.video_id)
  }
  return videoIds
}

export interface TodaySummary {
  /** Deliverables posted today. */
  posted: number
  /** Deliverables owed today, summed across active campaigns. */
  owed: number
  /** Videos edited and unposted - supply already banked, ready to go out. */
  postReadyCount: number
  /** Days of posting banked: ready stock divided by the daily obligation.
   *  Null when nothing is owed daily, because "days of posts" means nothing
   *  without a per-day figure to divide by. */
  runwayDays: number | null
  /** Videos filmed but not yet edited. */
  editBacklog: number
}

export function summariseToday(
  campaigns: readonly Campaign[],
  accounts: readonly CampaignAccount[],
  videos: readonly Video[],
  posts: readonly VideoPost[] = [],
  date: string = localToday(),
): TodaySummary {
  // Off the same boards the Post tab renders, rather than off the raw quotas
  // and every post in the store. The home screen said "5 of 6" on a day the
  // Post tab showed filled, because the two screens worked the day out
  // separately - Now counted campaigns Post had hidden, and counted posts on
  // accounts Post did not offer. There is now one derivation and both read it.
  const { owed, posted } = tallyBoards(boardsForToday(campaigns, accounts, posts, date))

  // Only stock belonging to a campaign still on the books. A deleted campaign
  // stops owing anything the moment it goes, so counting its half-finished
  // videos as banked runway would report supply against demand that no longer
  // exists - and its backlog would sit on the home screen asking to be edited
  // for a campaign he has removed.
  const live = new Set(campaigns.map((c) => c.id))
  const mine = videos.filter((v) => live.has(v.campaign_id))

  const postReadyCount = mine.filter((v) => v.phase === 'edited').length
  const editBacklog = mine.filter((v) => v.phase === 'filmed').length

  return {
    posted,
    owed,
    postReadyCount,
    runwayDays: owed > 0 ? Math.floor(postReadyCount / owed) : null,
    editBacklog,
  }
}
