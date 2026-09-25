// What the work pays.
//
// One formula, in his words: "$ per post x posts per day". $35 a post and one
// post a day is $35 a day. Three platforms does not make it $105, and a
// backlog of old videos marked posted in one sitting does not make it $455 -
// both of those were real figures this screen showed, and both came from
// counting something other than the campaign's own numbers.
//
// There are two exceptions, and both are things he told the app rather than
// things it worked out:
//
//   - a month he corrected by hand, for a deal no per-video rate can express
//     (Pump.Fun is a retainer; Inflow pays per completed 60-post cycle)
//   - a campaign that pays for each platform separately, where the same video
//     on Instagram, TikTok and YouTube really does earn three times
//
// That second one looks exactly like the bug this file exists to prevent, and
// the difference is the whole point: the old $105 came from the app DERIVING
// pay from the account list on its own. Here the campaign carries a flag he
// set, and the default is off. Nothing infers it.
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

/** Accounts of this campaign he can actually post from today. */
function postableAccounts(
  campaign: Campaign,
  accounts: readonly CampaignAccount[],
): CampaignAccount[] {
  return accounts.filter(
    (account) => account.campaign_id === campaign.id && account.is_active && canPostFrom(account),
  )
}

/** How many times one deliverable is paid for.
 *
 *  One, unless the campaign says each platform pays separately - and then it
 *  is the number of accounts he can post from, because an account still
 *  warming up earns nothing yet. Never fewer than one: a campaign with no
 *  ready account is handled by campaignIsLive, and returning zero here would
 *  quietly report a rate of nothing instead. */
export function payingPlatforms(
  campaign: Campaign,
  accounts: readonly CampaignAccount[] = [],
): number {
  if (!campaign.pays_per_platform) return 1
  return Math.max(1, postableAccounts(campaign, accounts).filter((account) => !account.bonus_only).length)
}

/** What one day of this campaign pays at its rate, or null when it has no rate
 *  saved.
 *
 *  Null rather than zero: a campaign whose rate nobody has typed yet pays an
 *  unknown amount, and showing $0.00 would be a claim about his earnings
 *  rather than a gap in what the app was told. */
export function dailyEarningsCents(
  campaign: Campaign,
  accounts: readonly CampaignAccount[] = [],
): number | null {
  if (campaign.pay_per_video_cents === null) return null
  return campaign.pay_per_video_cents * campaign.daily_post_quota * payingPlatforms(campaign, accounts)
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
export function monthlyPayCents(
  campaign: Campaign,
  accounts: readonly CampaignAccount[] = [],
): number | null {
  if (hasMonthlyOverride(campaign)) return campaign.monthly_pay_override_cents as number
  const day = dailyEarningsCents(campaign, accounts)
  return day === null ? null : day * DAYS_PER_MONTH
}

/** Campaigns ordered by what they pay, best first.
 *
 *  "Pays" is the month figure every screen already shows - his own where he
 *  gave one, the estimate otherwise - so the order on the screen agrees with
 *  the numbers beside it. A campaign with no rate saved has no known pay, and
 *  unknown is not zero: it goes last rather than being ranked as if it paid
 *  nothing. Ties fall back to the rate per video, then to the name, so the
 *  order never shuffles between renders. */
export function byBestPay<T extends Campaign>(
  campaigns: readonly T[],
  accounts: readonly CampaignAccount[] = [],
): T[] {
  const month = new Map(campaigns.map((c) => [c.id, monthlyPayCents(c, accounts)]))
  return [...campaigns].sort((a, b) => {
    const pa = month.get(a.id) ?? null
    const pb = month.get(b.id) ?? null
    if (pa === null && pb !== null) return 1
    if (pb === null && pa !== null) return -1
    if (pa !== null && pb !== null && pa !== pb) return pb - pa
    const ra = a.pay_per_video_cents ?? -1
    const rb = b.pay_per_video_cents ?? -1
    return rb - ra || a.name.localeCompare(b.name)
  })
}

export function campaignEarnings(
  campaign: Campaign,
  accounts: readonly CampaignAccount[] = [],
): PeriodEarnings | null {
  const day = dailyEarningsCents(campaign, accounts)
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
 *  on, and marked ready. One is the whole test even where each platform pays
 *  separately - the others change what it is worth, not whether it counts.
 *
 *  `canPostFrom` is the same function the Post tab uses, deliberately. If this
 *  screen decided "ready" for itself the two would drift, and MONEY would be
 *  counting campaigns POST refuses to show him a box for. */
export function campaignIsLive(
  campaign: Campaign,
  accounts: readonly CampaignAccount[],
): boolean {
  if (!campaign.is_active) return false
  return postableAccounts(campaign, accounts).length > 0
}

/** Every campaign that has a figure, added together.
 *
 *  Months are summed exactly rather than multiplied back up from the day
 *  total: where he has corrected a month, that number is the one he is owed,
 *  and a rounded day times thirty would quietly disagree with it. */
export function totalEarnings(
  campaigns: readonly Campaign[],
  accounts: readonly CampaignAccount[] = [],
): PeriodEarnings {
  return campaigns.reduce<PeriodEarnings>(
    (sum, campaign) => {
      const earnings = campaignEarnings(campaign, accounts)
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
export function campaignsWithoutRate(
  campaigns: readonly Campaign[],
  accounts: readonly CampaignAccount[] = [],
): Campaign[] {
  return campaigns.filter((campaign) => monthlyPayCents(campaign, accounts) === null)
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
