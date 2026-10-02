// What a tick earns, and the history those ticks leave behind.
//
// Pure functions only: LocalAdapter decides WHEN to write an event, this file
// decides WHAT it says and how a pile of them adds up. Keeping the arithmetic
// out of the adapter is what lets the Post screen, the history view and the
// tests all read one definition of "what did that tick pay".
//
// The history is append-only. Ticking a post appends a 'checkoff' for what it
// paid at that moment; unticking appends a 'reversal' of exactly that amount.
// A day's total is therefore always the sum of what was recorded, and cannot
// move when a rate is edited, an account is switched off or a box is unticked
// tomorrow - the properties the old "recompute it from the posts" figure could
// not have.

import type { Campaign, CampaignAccount, EarningsEvent } from './schema'
import { canPostFrom } from './warmup'

/** The first day the history covers. Earlier ticks are not backfilled: the
 *  figure he asked for starts here. */
export const EARNINGS_HISTORY_START = '2026-10-01'

/** What one post on this account pays on its own terms: the account's own
 *  rate where it has one, otherwise the campaign's. Null when neither is saved
 *  - unpriced, which is not the same as free. */
export function payForAccount(campaign: Campaign, account: CampaignAccount): number | null {
  return account.pay_per_post_cents ?? campaign.pay_per_video_cents
}

/** Whether each platform is paid separately for the same video.
 *
 *  True when the campaign says so (`pays_per_platform`), or when he gave any
 *  of its accounts a rate of its own - typing a different payout for TikTok is
 *  unambiguous, and requiring a second switch beside it would be the setting
 *  contradicting the number. Never inferred from the account list itself. */
export function paysPerPlatform(campaign: Campaign, accounts: readonly CampaignAccount[]): boolean {
  if (campaign.pays_per_platform) return true
  return accounts.some(
    (a) => a.campaign_id === campaign.id && a.is_active && a.pay_per_post_cents != null,
  )
}

/** Accounts a deliverable's single rate is shared across: those he can post
 *  from and that are paid per post. */
function sharingAccounts(campaign: Campaign, accounts: readonly CampaignAccount[]): number {
  return Math.max(
    1,
    accounts.filter(
      (a) => a.campaign_id === campaign.id && a.is_active && !a.bonus_only && canPostFrom(a),
    ).length,
  )
}

/** What ticking `account` for a video pays right now, in cents. Null when
 *  there is nothing to record: the account is paid only through bonuses, or
 *  there is no rate yet. Never zero standing in for "unknown".
 *
 *  `alreadyTicked` is how many OTHER accounts of the same video already have a
 *  live checkoff. It only matters when the platforms share one rate: the
 *  deliverable is worth the campaign rate in total, so each platform ticked
 *  earns its share, and the shares are rounded on the running total so a rate
 *  that does not divide evenly still adds up to exactly the rate once every
 *  paying platform is ticked. */
export function tickAmountCents(
  campaign: Campaign,
  accounts: readonly CampaignAccount[],
  account: CampaignAccount,
  alreadyTicked: number,
): number | null {
  if (account.bonus_only) return null

  if (paysPerPlatform(campaign, accounts)) return payForAccount(campaign, account)

  const rate = campaign.pay_per_video_cents
  if (rate === null) return null
  const total = sharingAccounts(campaign, accounts)
  const cumulative = (n: number) => Math.round((rate * Math.min(n, total)) / total)
  return cumulative(alreadyTicked + 1) - cumulative(alreadyTicked)
}

/** What one deliverable is worth across every platform it goes to, or null
 *  when no figure exists. Separate platform pay sums each paying account's
 *  rate; otherwise it is the campaign rate once. The money screens multiply
 *  this by posts per week. */
export function deliverableCents(
  campaign: Campaign,
  accounts: readonly CampaignAccount[],
): number | null {
  if (!paysPerPlatform(campaign, accounts)) return campaign.pay_per_video_cents

  const paying = accounts.filter(
    (a) => a.campaign_id === campaign.id && a.is_active && !a.bonus_only && canPostFrom(a),
  )
  const known = paying.map((a) => payForAccount(campaign, a)).filter((c): c is number => c !== null)
  if (known.length === 0) return campaign.pay_per_video_cents === null ? null : campaign.pay_per_video_cents
  return known.reduce((sum, c) => sum + c, 0)
}

// --- Reading the history ---------------------------------------------------

/** Checkoffs that have not been taken back. */
export function liveCheckoffs(events: readonly EarningsEvent[]): EarningsEvent[] {
  const reversed = new Set(
    events.filter((e) => e.source === 'reversal' && e.reverses_id !== null).map((e) => e.reverses_id),
  )
  return events.filter((e) => e.source === 'checkoff' && !reversed.has(e.id))
}

/** Everything the events add up to. Reversals are negative, so a plain sum is
 *  the net. */
export function netCents(events: readonly EarningsEvent[]): number {
  return events.reduce((sum, e) => sum + e.amount_cents, 0)
}

/** What was earned on a calendar day (YYYY-MM-DD, local). */
export function earnedOnDate(events: readonly EarningsEvent[], date: string): number {
  return netCents(events.filter((e) => e.earned_on === date))
}

export type Period = 'day' | 'week' | 'month'

export interface PeriodTotal {
  /** Sort key and label source: the day, the Monday of the week, or YYYY-MM. */
  key: string
  cents: number
}

/** Monday of the week containing `date`. Calendar arithmetic on the date
 *  string only - no timezone, no clock - so a day never lands in the wrong
 *  week because of where the browser thinks it is. */
export function weekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d))
  const sinceMonday = (day.getUTCDay() + 6) % 7
  day.setUTCDate(day.getUTCDate() - sinceMonday)
  return day.toISOString().slice(0, 10)
}

export function periodKey(date: string, period: Period): string {
  if (period === 'day') return date
  if (period === 'week') return weekStart(date)
  return date.slice(0, 7)
}

/** Net totals per period, newest first. */
export function totalsBy(events: readonly EarningsEvent[], period: Period): PeriodTotal[] {
  const sums = new Map<string, number>()
  for (const event of events) {
    const key = periodKey(event.earned_on, period)
    sums.set(key, (sums.get(key) ?? 0) + event.amount_cents)
  }
  return [...sums.entries()]
    .map(([key, cents]) => ({ key, cents }))
    .sort((a, b) => b.key.localeCompare(a.key))
}
