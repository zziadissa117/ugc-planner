// Whether an account still needs warming up, and how long that takes.
//
// This used to be a question about a campaign, inferred from whether it had
// ever posted. It is a question about an ACCOUNT: two accounts on one campaign
// warm up separately, and he asked to decide it himself. So `status` on the
// account is the answer, and he can set it by hand.
//
// `needsWarmup` means "not ready to post from yet", and that is all it means.
// It is not the same question as "should this appear on the warm-up list": a
// ready account still wants a scroll now and then to stay alive, and the home
// screen lists every account for exactly that reason. What changes with status
// is how long the sitting is and how it reads - see warmupMinutesFor.
//
// Completing sessions still promotes automatically, and "warmed up twice" is
// counted from warmup_events at query time rather than kept as a number on the
// row - a stored counter drifts from the log that explains it.

import type { CampaignAccount, WarmupEvent } from './schema'

export const WARMUP_SESSIONS_REQUIRED = 2

/** How long a warm-up runs, by what the account is for.
 *
 *  A new account is being built a history, which takes a real sitting. A ready
 *  account is only being kept alive - "keep a warmup section for all accounts
 *  just to make sure i keep them fresh and remember, the time for scrolling
 *  will only be 5 minutes for the ready accounts" - and five minutes of
 *  scrolling is the whole of that job. */
export const WARMUP_MINUTES_BUILDING = 15
export const WARMUP_MINUTES_MAINTENANCE = 5

export function warmupMinutesFor(account: CampaignAccount): number {
  return account.status === 'ready' ? WARMUP_MINUTES_MAINTENANCE : WARMUP_MINUTES_BUILDING
}

/** When this account was last warmed up, or null if it never has been.
 *
 *  Read off the log rather than kept on the row, the same as the count: a
 *  stored "last warmed" drifts from the events that explain it. This is what
 *  makes a ready account's line say how long it has been left alone. */
export function lastWarmupAt(
  accountId: string,
  events: readonly WarmupEvent[],
): string | null {
  let latest: string | null = null
  for (const event of events) {
    if (event.account_id !== accountId) continue
    if (latest === null || event.occurred_at > latest) latest = event.occurred_at
  }
  return latest
}

/** Sessions completed against this account.
 *
 *  Only events carrying its id count. Events recorded before accounts existed
 *  name a campaign and no account, and are deliberately not counted for any of
 *  them: attributing an old campaign-level session to one of two accounts
 *  would be a coin flip presented as history. The status derived during the
 *  v4 upgrade is what carries their meaning forward. */
export function warmupCompletions(accountId: string, events: readonly WarmupEvent[]): number {
  return events.filter((event) => event.account_id === accountId).length
}

/** Platforms where an account is usable the day it is made.
 *
 *  YouTube is not a place a new account gets throttled for posting: "youtube
 *  accounts dont need to warmup so remove them from warmups." So a YouTube
 *  account never appears on the warm-up list and is never held off the Post
 *  tab, whatever its status column happens to say. The column is left alone
 *  rather than forced to 'ready' - nothing should rewrite his rows to make a
 *  screen come out right, and the rule belongs in one place instead. */
export const PLATFORMS_WITHOUT_WARMUP: readonly string[] = ['YouTube']

/** True when warming up is a thing this account does at all. */
export function warmsUp(account: CampaignAccount): boolean {
  return !PLATFORMS_WITHOUT_WARMUP.includes(account.platform)
}

/** True while an account is not ready to post brand content from.
 *
 *  A platform that does not warm up is never "not ready": there is no sitting
 *  that would change anything, so waiting on one would hold a campaign off the
 *  Post tab forever. */
export function needsWarmup(account: CampaignAccount): boolean {
  return warmsUp(account) && account.status !== 'ready'
}

/** True when he can post brand content from this account today. The exact
 *  inverse of needsWarmup, named for the question the Post tab asks. */
export function canPostFrom(account: CampaignAccount): boolean {
  return !needsWarmup(account)
}

/** The status an account should hold after `completions` sessions.
 *
 *  Never demotes: an account he has marked ready by hand stays ready, because
 *  he knows something the count does not. */
export function statusAfterWarmup(
  account: CampaignAccount,
  completions: number,
): CampaignAccount['status'] {
  if (account.status === 'ready') return 'ready'
  if (completions >= WARMUP_SESSIONS_REQUIRED) return 'ready'
  return completions > 0 ? 'warming' : account.status
}
