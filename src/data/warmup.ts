// Whether an account still needs warming up, and how long that takes.
//
// This used to be a question about a campaign, inferred from whether it had
// ever posted. It is a question about an ACCOUNT: two accounts on one campaign
// warm up separately, and he asked to decide it himself. So `status` on the
// account is the answer, and he can set it by hand.
//
// Three questions live here and they are deliberately not the same one:
//
//   warmsUp       - does this platform warm up at all? (YouTube does not)
//   needsWarmup   - should this account be on the warm-up list right now?
//   canPostFrom   - may he post brand content from it today?
//
// Collapsing any pair of them has gone wrong before. The warm-up list once
// showed only accounts that were not ready, when a ready one still wants a
// scroll to stay alive; and canPostFrom was once the inverse of needsWarmup,
// which made a brand new YouTube account postable because its platform skips
// warm-up. Status decides posting; platform decides warming.
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
 *  account never appears on the warm-up list, whatever its status says.
 *
 *  It is still held off the Post tab until he marks it ready - see
 *  canPostFrom. Skipping warm-up is a fact about the platform; being ready to
 *  post from is a fact about the account, and his status column is the only
 *  thing that says it. Nothing here rewrites that column to make a screen come
 *  out right. */
export const PLATFORMS_WITHOUT_WARMUP: readonly string[] = ['YouTube']

/** True when warming up is a thing this account does at all. */
export function warmsUp(account: CampaignAccount): boolean {
  return !PLATFORMS_WITHOUT_WARMUP.includes(account.platform)
}

/** True when this account belongs on the warm-up list.
 *
 *  Two conditions, and they are different questions: warming up has to be a
 *  thing this platform does at all, and the account has to not be ready yet.
 *  A YouTube account is never here, however it is marked. */
export function needsWarmup(account: CampaignAccount): boolean {
  return warmsUp(account) && account.status !== 'ready'
}

/** True when he can post brand content from this account today.
 *
 *  Status, and nothing else. This used to be the inverse of needsWarmup, which
 *  quietly made a YouTube account postable the moment it existed - the platform
 *  skips warm-up, so it could never be "not ready". He wanted the two separated:
 *  "Do not put youtube in the posting section if its warming or new, do not put
 *  it in warmup section too, only put it in post section when ready." So the
 *  platform decides whether warming up is a thing it does; the status decides
 *  whether he posts from it. A YouTube account he has not marked ready is off
 *  the Post tab and off the warm-up list both, and the place he makes it ready
 *  is the status row on the campaign's brief. */
export function canPostFrom(account: CampaignAccount): boolean {
  return account.status === 'ready'
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

/** How many whole days an account with no platform rule of its own can go
 *  without a session before it counts as overdue. Seven is a starting point,
 *  not a rule from him or from any platform. */
export const WARMUP_STALE_DAYS = 7

/** Days without a session after which a TikTok or Instagram account is
 *  overdue - the number he set: "no warmup for 2 days or more, tell me to warm
 *  it up urgently."
 *
 *  It is NOT a published platform rule, and the app must not present it as
 *  one. Neither platform publishes anything about warming up. What the
 *  community and marketing guides agree on is qualitative: keep a little
 *  human-looking activity going every day (roughly 5-10 minutes on TikTok once
 *  warm), because a long silence followed by a burst of posting reads as
 *  automation, and accounts idle for weeks generally need re-warming from
 *  scratch. Two days is a deliberately tight reminder cadence well inside
 *  that, so an account is never left anywhere near the point that starts to
 *  cost reach. Other platforms have no entry here and fall back to
 *  WARMUP_STALE_DAYS. */
export const WARMUP_LIMIT_DAYS: Readonly<Record<string, number>> = {
  TikTok: 2,
  Instagram: 2,
}

/** The days this account can be left alone before it is overdue. */
export function warmupLimitDays(account: CampaignAccount): number {
  return WARMUP_LIMIT_DAYS[account.platform] ?? WARMUP_STALE_DAYS
}

/** Whole days since `iso`, the same rounding the "4d ago" label uses. */
export function daysSince(iso: string, now: number = Date.now()): number {
  return Math.floor((now - new Date(iso).getTime()) / 86_400_000)
}

/** Where an account sits on the warm-up list, most pressing first.
 *
 *    overdue  - past its platform's limit, or never warmed at all (see
 *               warmupLimitDays). Red, and its own section: this is the list
 *               of accounts to warm up right now to keep them from going cold.
 *    urgent   - brand new. Red as well: it is what holds a campaign off the
 *               Post tab.
 *    building - part-way through its first sessions, and within its limit.
 *    ready    - done, and warmed within its limit, so it is only being kept
 *               alive. Last on the list.
 *
 *  A ready account is not automatically at the bottom: "ready" only says it
 *  may post, not that it is still fresh. */
export type WarmupTier = 'overdue' | 'urgent' | 'building' | 'ready'

export function warmupTier(
  account: CampaignAccount,
  lastWarmedAt: string | null,
  now: number = Date.now(),
): WarmupTier {
  if (account.status === 'new') return 'urgent'
  if (lastWarmedAt === null || daysSince(lastWarmedAt, now) >= warmupLimitDays(account)) {
    return 'overdue'
  }
  return account.status === 'warming' ? 'building' : 'ready'
}

/** Orders two accounts within a tier: brand-new before the merely neglected,
 *  then whichever has gone longest without a session, never-warmed first. */
export function compareWarmupPriority(
  a: { account: CampaignAccount; last: string | null },
  b: { account: CampaignAccount; last: string | null },
): number {
  const byNew = Number(b.account.status === 'new') - Number(a.account.status === 'new')
  if (byNew !== 0) return byNew
  // ISO timestamps sort as text, and '' sorts before any of them.
  return (a.last ?? '').localeCompare(b.last ?? '')
}
