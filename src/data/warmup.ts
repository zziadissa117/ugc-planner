// Whether an account still needs warming up.
//
// This used to be a question about a campaign, inferred from whether it had
// ever posted. It is a question about an ACCOUNT: two accounts on one campaign
// warm up separately, and he asked to decide it himself - "warmup the accounts
// set as NEW or WARMING UP i will see there, i dont want to see already warmed
// up accounts there". So `status` on the account is the answer, and he can set
// it by hand.
//
// Completing sessions still promotes automatically, and "warmed up twice" is
// counted from warmup_events at query time rather than kept as a number on the
// row - a stored counter drifts from the log that explains it.

import type { CampaignAccount, WarmupEvent } from './schema'

export const WARMUP_SESSIONS_REQUIRED = 2

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

/** True while an account is not ready to post brand content from. */
export function needsWarmup(account: CampaignAccount): boolean {
  return account.status !== 'ready'
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
