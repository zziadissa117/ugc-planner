// What the work pays.
//
// One formula, in his words: "$ per post x posts per day". $35 a post and one
// post a day is $35 a day. Three platforms does not make it $105, and a
// backlog of old videos marked posted in one sitting does not make it $455 -
// both of those were real figures this screen showed, and both came from
// counting something other than the campaign's own two numbers.
//
// So earnings are derived from the campaign row alone:
//
//     day   = pay_per_video_cents x daily_post_quota
//     week  = day x 7
//     month = day x 30
//
// Nothing here reads the account list, the video list or the post list. There
// is no path by which a UI element, a duplicated row or a busy afternoon can
// change what a day is worth.
//
// Everything is integer cents. Division happens only at the display edge.

import type { Campaign } from './data'

/** Days used for the week and month figures. Fixed rather than calendar-aware
 *  on purpose: this is what the work pays at his current quota, not a ledger
 *  of a particular month, so "a month" is thirty days of it. */
export const DAYS_PER_WEEK = 7
export const DAYS_PER_MONTH = 30

export interface PeriodEarnings {
  dayCents: number
  weekCents: number
  monthCents: number
}

/** What one day of this campaign pays, or null when it has no rate saved.
 *
 *  Null rather than zero: a campaign whose rate nobody has typed yet pays an
 *  unknown amount, and showing $0.00 would be a claim about his earnings
 *  rather than a gap in what the app was told. */
export function dailyEarningsCents(campaign: Campaign): number | null {
  if (campaign.pay_per_video_cents === null) return null
  return campaign.pay_per_video_cents * campaign.daily_post_quota
}

export function periodsFor(dayCents: number): PeriodEarnings {
  return {
    dayCents,
    weekCents: dayCents * DAYS_PER_WEEK,
    monthCents: dayCents * DAYS_PER_MONTH,
  }
}

export function campaignEarnings(campaign: Campaign): PeriodEarnings | null {
  const day = dailyEarningsCents(campaign)
  return day === null ? null : periodsFor(day)
}

/** Every campaign that has a rate, added together. Campaigns without one are
 *  left out rather than counted as zero, and the screen says how many. */
export function totalEarnings(campaigns: readonly Campaign[]): PeriodEarnings {
  const day = campaigns.reduce((sum, campaign) => sum + (dailyEarningsCents(campaign) ?? 0), 0)
  return periodsFor(day)
}

export function campaignsWithoutRate(campaigns: readonly Campaign[]): Campaign[] {
  return campaigns.filter((campaign) => campaign.pay_per_video_cents === null)
}

/** A fixed approximation, not a live rate - the app is local-first and works
 *  fully offline, so this deliberately does not fetch one. It is labelled as
 *  approximate everywhere it is shown; update this constant by hand if it
 *  drifts far from the real rate. */
export const USD_TO_CAD_RATE = 1.37

export function toCadCents(usdCents: number): number {
  return Math.round(usdCents * USD_TO_CAD_RATE)
}

/** Integer cents in, a readable figure out. The division happens at the edge,
 *  for display only - storage is always integer cents. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  return `${sign}$${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}
