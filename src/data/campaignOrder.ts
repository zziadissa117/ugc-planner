// The order the Campaigns list shows campaigns in.
//
// "Campaigns that need high-quality videos come first - they are recorded
// first in a batch; quick and easy ones last." High quality is a campaign with
// a minimum number of views: a video under it does not count, so it gets the
// fresh, careful takes at the start of a recording batch. Everything else is
// quick and easy and goes at the end.
//
// Within each group the order the campaigns arrive in is kept (the list hands
// them over best-pay first), so this only ever splits, never reshuffles.
//
// The Campaigns list only. The Post screen keeps the order he set by hand
// (inPostOrder in src/money.ts): nothing here reads or writes post_position.

import type { Campaign } from './schema'

/** True when the campaign has a minimum number of views per video.
 *
 *  Loose `!= null` on purpose: a row pulled from the server before the column
 *  existed arrives without it, and that is "no minimum", not a minimum. */
export function needsHighQuality(campaign: Pick<Campaign, 'min_views'>): boolean {
  return campaign.min_views != null
}

/** The campaigns split into the two groups the list shows, each in the order
 *  it came in. */
export function recordingGroups<T extends Pick<Campaign, 'min_views'>>(
  campaigns: readonly T[],
): { highQuality: T[]; quick: T[] } {
  return {
    highQuality: campaigns.filter(needsHighQuality),
    quick: campaigns.filter((campaign) => !needsHighQuality(campaign)),
  }
}

/** The same order as one list: high quality first, quick ones last. */
export function byRecordingPriority<T extends Pick<Campaign, 'min_views'>>(campaigns: readonly T[]): T[] {
  const { highQuality, quick } = recordingGroups(campaigns)
  return [...highQuality, ...quick]
}
