// When a campaign pays, and whether the latest payout has arrived.
//
// A campaign carries a schedule (none, one-off, weekly, biweekly, monthly) and
// the date of its first or only payout. Each occurrence is identified by its
// due date, and "paid" is a row in campaign_payouts for that date - so every
// recurrence has its own status and ticking one off does not touch the next.
// Pending is simply the absence of that row.
//
// Calendar arithmetic on YYYY-MM-DD strings only, for the same reason as
// weekStart in earnings.ts: a payout date is a date on a calendar, not an
// instant, and must not shift with the browser's timezone.

import type { Campaign, CampaignPayout, PayoutSchedule } from './schema'

export const PAYOUT_SCHEDULE_LABELS: Record<PayoutSchedule, string> = {
  none: 'No payout date',
  one_off: 'Once',
  weekly: 'Every week',
  biweekly: 'Every 2 weeks',
  monthly: 'Every month',
}

function parse(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number)
  return { y, m, d }
}

function format(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function addDays(date: string, days: number): string {
  const { y, m, d } = parse(date)
  const next = new Date(Date.UTC(y, m - 1, d + days))
  return next.toISOString().slice(0, 10)
}

/** `months` after `anchor`, on the same day of the month, or the last day of a
 *  month too short for it (the 31st becomes the 30th, or the 28th). Always
 *  computed from the anchor rather than from the previous occurrence, so
 *  January 31 -> February 28 -> March 31 and not -> March 28. */
function addMonths(anchor: string, months: number): string {
  const { y, m, d } = parse(anchor)
  const index = m - 1 + months
  const year = y + Math.floor(index / 12)
  const month = (((index % 12) + 12) % 12) + 1
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return format(year, month, Math.min(d, last))
}

/** The n-th occurrence (0 is the anchor itself). */
function occurrence(schedule: PayoutSchedule, anchor: string, n: number): string {
  switch (schedule) {
    case 'weekly':
      return addDays(anchor, 7 * n)
    case 'biweekly':
      return addDays(anchor, 14 * n)
    case 'monthly':
      return addMonths(anchor, n)
    default:
      return anchor
  }
}

export interface PayoutDue {
  dueDate: string
  /** The payout's row, when it has been marked paid. */
  paid: CampaignPayout | null
}

export interface PayoutStatus {
  /** The payout he is waiting on or has just had: the latest one on or before
   *  today. Null before the first payout date. */
  latest: PayoutDue | null
  /** The next one still to come, null for a one-off that has passed. */
  next: string | null
  /** True when the latest payout is past its date and not marked paid. */
  overdue: boolean
}

/** How far back an unpaid payout still counts as something to chase. Older
 *  than this and it is history, not a to-do. */
const LOOKBACK_DAYS = 62

/** Where this campaign's payouts stand on `today`. Null when no payout date
 *  has been saved - nothing to show, and nothing is guessed. */
export function payoutStatus(
  campaign: Pick<Campaign, 'id' | 'payout_schedule' | 'payout_date'>,
  payouts: readonly CampaignPayout[],
  today: string,
): PayoutStatus | null {
  const { payout_schedule: schedule, payout_date: anchor } = campaign
  if (schedule === 'none' || anchor === null) return null

  const paidOn = (due: string) =>
    payouts.find((p) => p.campaign_id === campaign.id && p.due_date === due) ?? null

  if (schedule === 'one_off') {
    if (anchor > today) return { latest: null, next: anchor, overdue: false }
    const paid = paidOn(anchor)
    return {
      latest: { dueDate: anchor, paid },
      next: null,
      overdue: paid === null && addDays(anchor, LOOKBACK_DAYS) >= today,
    }
  }

  // Walk forward from the anchor to the last occurrence on or before today.
  // Bounded: a weekly schedule anchored a decade ago is ~520 steps.
  let n = 0
  let latest: string | null = null
  while (occurrence(schedule, anchor, n) <= today && n < 5000) {
    latest = occurrence(schedule, anchor, n)
    n += 1
  }
  const next = occurrence(schedule, anchor, n)

  if (latest === null) return { latest: null, next, overdue: false }

  const paid = paidOn(latest)
  const stale = addDays(latest, LOOKBACK_DAYS) < today
  return {
    latest: { dueDate: latest, paid },
    next,
    overdue: paid === null && !stale,
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-10-15" -> "Oct 15". Read off the string, never through Date, so the
 *  day shown is the day saved whatever zone the browser is in. */
export function formatDay(date: string): string {
  const { m, d } = parse(date)
  return `${MONTHS[m - 1] ?? '?'} ${d}`
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** "2026-10" -> "October 2026". */
export function formatMonth(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return `${MONTH_NAMES[m - 1] ?? '?'} ${y}`
}
