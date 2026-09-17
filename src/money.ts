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
// with one exception he asked for: where he has corrected the month by hand,
// his figure wins. Some deals cannot be expressed as a per-video rate at all -
// Pump.Fun is a monthly retainer, Inflow pays per completed 60-post cycle -
// and an estimate that is confidently wrong is worse than one he can fix.
//
// No arithmetic here counts videos, posts or platforms. The one thing that
// reads the account list is campaignIsLive, and it is a yes/no about whether a
// campaign counts at all - never a multiplier on what it is worth.
//
// Everything is integer cents. Division happens only at the display edge.

import type { Campaign, CampaignAccount } from './data'
import { canPostFrom } from './data'

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

/** What one day of this campaign pays at its rate, or null when it has no rate
 *  saved.
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

/** True when the month shown is his own correction rather than the estimate.
 *
 *  Loose `!= null` on purpose, so an undefined reads as "no correction" too. A
 *  campaign row pulled from the server before this column existed arrives
 *  without the field at all, and a strict check would have treated that
 *  absence as a figure and turned every total into NaN. */
export function hasMonthlyOverride(campaign: Campaign): boolean {
  return campaign.monthly_pay_override_cents != null
}

/** What this campaign pays in a month: his figure where he has given one, the
 *  estimate otherwise, and null when there is neither. */
export function monthlyPayCents(campaign: Campaign): number | null {
  if (hasMonthlyOverride(campaign)) return campaign.monthly_pay_override_cents as number
  const day = dailyEarningsCents(campaign)
  return day === null ? null : day * DAYS_PER_MONTH
}

export function campaignEarnings(campaign: Campaign): PeriodEarnings | null {
  const day = dailyEarningsCents(campaign)
  if (!hasMonthlyOverride(campaign)) return day === null ? null : periodsFor(day)

  // Working back from his monthly figure, so the three periods agree with each
  // other rather than one of them quietly contradicting the number he typed.
  // The month stays exactly what he said; the day is what it divides into.
  const month = campaign.monthly_pay_override_cents as number
  const perDay = Math.round(month / DAYS_PER_MONTH)
  return { dayCents: perDay, weekCents: perDay * DAYS_PER_WEEK, monthCents: month }
}

/** True when this campaign's pay counts right now.
 *
 *  Active, and with at least one account he can actually post from: switched
 *  on, and marked ready. Pay is per campaign and not per account, so a second
 *  ready account adds nothing - one is the whole test.
 *
 *  `canPostFrom` is the same function the Post tab uses, deliberately. If this
 *  screen decided "ready" for itself the two would drift, and MONEY would be
 *  counting campaigns POST refuses to show him a box for. */
export function campaignIsLive(
  campaign: Campaign,
  accounts: readonly CampaignAccount[],
): boolean {
  if (!campaign.is_active) return false
  return accounts.some(
    (account) => account.campaign_id === campaign.id && account.is_active && canPostFrom(account),
  )
}

/** Every campaign that has a figure, added together.
 *
 *  Months are summed exactly rather than multiplied back up from the day
 *  total: where he has corrected a month, that number is the one he is owed,
 *  and a rounded day times thirty would quietly disagree with it. */
export function totalEarnings(campaigns: readonly Campaign[]): PeriodEarnings {
  return campaigns.reduce<PeriodEarnings>(
    (sum, campaign) => {
      const earnings = campaignEarnings(campaign)
      if (earnings === null) return sum
      return {
        dayCents: sum.dayCents + earnings.dayCents,
        weekCents: sum.weekCents + earnings.weekCents,
        monthCents: sum.monthCents + earnings.monthCents,
      }
    },
    { dayCents: 0, weekCents: 0, monthCents: 0 },
  )
}

/** Campaigns with no figure at all - no rate, and no month he has corrected. */
export function campaignsWithoutRate(campaigns: readonly Campaign[]): Campaign[] {
  return campaigns.filter((campaign) => monthlyPayCents(campaign) === null)
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
