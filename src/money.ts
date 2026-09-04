// Money. SPEC section 10.
//
// Three figures that are never summed into one, and a fourth state that is not
// a figure at all.
//
//   DOCUMENTED    posted videos times the rate each locked in at. Earned.
//   EXPECTED      bonus payout times a probability the user typed. Not earned,
//                 and $0 until he judges something himself.
//   USER ENTERED  bonus money actually logged as received. Earned, and known
//                 only because he said so.
//   UNPRICED      posted videos with no rate snapshot. Not a figure - a count.
//                 These are posts whose pay is unknown, not posts worth zero,
//                 and folding them in either direction would be a lie.
//
// There is no total here on purpose. Adding accrued base pay to a probability-
// weighted guess to money already banked produces a number that is not true in
// any sense, and it is the number a person would most want to believe.
//
// Everything is integer cents. Division happens only at the display edge.

import type { BonusClaim, BonusTier, Campaign, CampaignField, Video } from './data'

/** The rate he says his carried-over posts were paid at.
 *
 *  Read only once he has confirmed it. It is never derived from the campaign's
 *  current rate: today's rate is a fact about today, and using it here would
 *  turn a guess into earnings history that nothing afterwards could flag as
 *  unchecked. Unset means unknown, and unknown stays blank. */
export const OPENING_BALANCE_RATE_KEY = 'opening_balance_rate_cents'

function confirmedOpeningRate(fields: readonly CampaignField[]): number | null {
  const field = fields.find((f) => f.field_key === OPENING_BALANCE_RATE_KEY)
  if (!field || field.confirmed_at === null || field.field_value === null) return null

  const cents = Number(field.field_value)
  // Money is integer cents. Anything else is not a rate we will show.
  if (!Number.isInteger(cents) || cents < 0) return null
  return cents
}

export interface CampaignMoney {
  campaign: Campaign

  /** DOCUMENTED. Posted videos times their own locked rate. */
  documentedCents: number
  pricedPostedCount: number

  /** The fourth state: posted, but the rate was unknown at the time. */
  unpricedPostedCount: number
  /** True when the campaign now has a rate, so those posts can be priced. */
  canBackfill: boolean

  /** EXPECTED. Zero until he types a probability. */
  expectedBonusCents: number
  /** USER ENTERED. Only what was logged as received. */
  receivedBonusCents: number

  /** Posts carried in from before the app existed. A count, and money only if
   *  he has told us what they paid - see openingBalanceCents. */
  openingPostCount: number

  /** The rate he confirmed for those carried-over posts, or null if he has not
   *  said. Never derived from the campaign's current rate. */
  openingBalanceRateCents: number | null

  /** openingPostCount times that rate, or null while the rate is unknown.
   *
   *  Documented in the same sense as the per-video total - he stated it - but
   *  kept as its own figure rather than added to it. The per-video total is
   *  built from rates this app watched being locked in; this one is his
   *  recollection of what happened before it existed. Both are honest; they
   *  are not the same kind of honest. */
  openingBalanceCents: number | null
  /** Posts this app has actually seen happen. */
  postedInAppCount: number

  /** Where the payment cycle stands - the opening balance counts toward it. */
  cyclePosition: number
  cycleSize: number | null
  completedCycles: number
  postsIntoCurrentCycle: number
  /** Inflow pays only when a cycle completes. Until then base pay is accrued,
   *  not payable. */
  isPayable: boolean
}

export function summariseCampaignMoney(
  campaign: Campaign,
  videos: readonly Video[],
  tiers: readonly BonusTier[],
  claims: readonly BonusClaim[],
  fields: readonly CampaignField[] = [],
): CampaignMoney {
  const mine = videos.filter((v) => v.campaign_id === campaign.id)
  const posted = mine.filter((v) => v.phase === 'posted')

  const priced = posted.filter((v) => v.rate_snapshot_cents !== null)
  const documentedCents = priced.reduce((sum, v) => sum + (v.rate_snapshot_cents ?? 0), 0)
  const unpricedPostedCount = posted.length - priced.length

  const myTiers = tiers.filter((t) => t.campaign_id === campaign.id)
  const tierById = new Map(myTiers.map((t) => [t.id, t]))
  const videoIds = new Set(mine.map((v) => v.id))
  const myClaims = claims.filter((c) => videoIds.has(c.video_id) && tierById.has(c.bonus_tier_id))

  // EXPECTED. Rounded to whole cents, because money is integer cents and a
  // probability is not.
  const expectedBonusCents = myClaims.reduce((sum, claim) => {
    const tier = tierById.get(claim.bonus_tier_id)
    return sum + (tier ? Math.round(tier.payout_cents * claim.probability) : 0)
  }, 0)

  // USER ENTERED. received_at is required alongside the amount, so a row
  // without one cannot exist.
  const receivedBonusCents = myClaims.reduce((sum, claim) => sum + (claim.received_cents ?? 0), 0)

  const postedInAppCount = posted.length
  const cyclePosition = campaign.opening_post_count + postedInAppCount
  const cycleSize = campaign.cycle_size

  const completedCycles = cycleSize === null ? 0 : Math.floor(cyclePosition / cycleSize)
  const postsIntoCurrentCycle = cycleSize === null ? cyclePosition : cyclePosition % cycleSize

  const openingBalanceRateCents = confirmedOpeningRate(
    fields.filter((f) => f.campaign_id === campaign.id),
  )

  return {
    campaign,
    documentedCents,
    pricedPostedCount: priced.length,
    unpricedPostedCount,
    canBackfill: unpricedPostedCount > 0 && campaign.pay_per_video_cents !== null,
    expectedBonusCents,
    receivedBonusCents,
    openingPostCount: campaign.opening_post_count,
    openingBalanceRateCents,
    openingBalanceCents:
      openingBalanceRateCents === null
        ? null
        : campaign.opening_post_count * openingBalanceRateCents,
    postedInAppCount,
    cyclePosition,
    cycleSize,
    completedCycles,
    postsIntoCurrentCycle,
    // No cycle size means nothing gates payment, so there is nothing to wait
    // for. With one, pay arrives only when a cycle closes.
    isPayable: cycleSize === null ? true : completedCycles > 0,
  }
}

export function summariseAllMoney(
  campaigns: readonly Campaign[],
  videos: readonly Video[],
  tiers: readonly BonusTier[],
  claims: readonly BonusClaim[],
  fields: readonly CampaignField[] = [],
): CampaignMoney[] {
  return campaigns.map((campaign) =>
    summariseCampaignMoney(campaign, videos, tiers, claims, fields),
  )
}

/** Totals per figure, across campaigns. Each figure is only ever added to more
 *  of its own kind - there is deliberately no function here that combines
 *  them, because there is no honest way to. */
export interface MoneyTotals {
  documentedCents: number
  expectedBonusCents: number
  receivedBonusCents: number
  unpricedPostedCount: number
}

export function totalMoney(summaries: readonly CampaignMoney[]): MoneyTotals {
  return summaries.reduce<MoneyTotals>(
    (totals, s) => ({
      documentedCents: totals.documentedCents + s.documentedCents,
      expectedBonusCents: totals.expectedBonusCents + s.expectedBonusCents,
      receivedBonusCents: totals.receivedBonusCents + s.receivedBonusCents,
      unpricedPostedCount: totals.unpricedPostedCount + s.unpricedPostedCount,
    }),
    { documentedCents: 0, expectedBonusCents: 0, receivedBonusCents: 0, unpricedPostedCount: 0 },
  )
}
