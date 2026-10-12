// A warm-up session: the accounts that need warming, one at a time.
//
// The home screen used to list every account that needed it, grouped by how
// overdue - after a week away, a wall of red. He asked for one at a time:
// "only show me one account to warm up. I click on it, the 15 minutes start,
// and then it moves on to the next, into the next." So the screen shows the
// one that matters most, a tap starts a session, and when each timer runs
// out it is marked warmed and the next one's timer starts by itself
// (warmupTimers.tsx). Brand-new accounts come first: they are the ones a
// campaign is waiting on.
//
// The queue is a snapshot taken when the session starts - what to warm and
// for how long - kept in localStorage beside the timers, so a session
// survives a reload and moving between tabs the same way a timer does.
// Pure, so the order and the steps are tested (warmupSession.test.ts).

import type { Campaign, CampaignAccount, WarmupEvent } from './data'
import { compareWarmupPriority, lastWarmupAt, localToday, warmupMinutesFor, warmupTier } from './data'
import type { WarmupTier } from './data/warmup'
import { KNOWN_PLATFORMS } from './components/platforms'

const STORAGE_KEY = 'ugc-planner.warmup_session'

/** New first - he wants a fresh account warmed before anything else - then
 *  the neglected, then the ones part-way, then the ones only kept fresh. */
const TIER_ORDER: readonly WarmupTier[] = ['urgent', 'overdue', 'building', 'ready']

export interface QueuedAccount {
  account: CampaignAccount
  tier: WarmupTier
  last: string | null
}

/** Every account not warmed today, in the order a session takes them:
 *  by tier (new, overdue, warming, ready), then the campaign that pays best,
 *  then whichever has gone longest alone, then name and platform so it never
 *  shuffles between renders. */
export function warmupQueue(
  accounts: readonly CampaignAccount[],
  campaigns: readonly Campaign[],
  events: readonly WarmupEvent[],
  payRank: ReadonlyMap<string, number>,
  now: number = Date.now(),
): QueuedAccount[] {
  const today = localToday(new Date(now))
  const nameById = new Map(campaigns.map((c) => [c.id, c.name]))
  const platformRank = (platform: string) => {
    const index = (KNOWN_PLATFORMS as readonly string[]).indexOf(platform)
    return index === -1 ? KNOWN_PLATFORMS.length : index
  }
  return accounts
    .map((account) => {
      const last = lastWarmupAt(account.id, events)
      return { account, last, tier: warmupTier(account, last, now) }
    })
    .filter((q) => q.last === null || localToday(new Date(q.last)) !== today)
    .sort(
      (a, b) =>
        TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) ||
        (payRank.get(a.account.campaign_id) ?? Number.MAX_SAFE_INTEGER) -
          (payRank.get(b.account.campaign_id) ?? Number.MAX_SAFE_INTEGER) ||
        compareWarmupPriority(a, b) ||
        (nameById.get(a.account.campaign_id) ?? '').localeCompare(nameById.get(b.account.campaign_id) ?? '') ||
        platformRank(a.account.platform) - platformRank(b.account.platform),
    )
}

/** One account in a running session: what its timer needs, taken when the
 *  session started. */
export interface SessionItem {
  accountId: string
  platform: string
  handle: string | null
  campaignName: string
  minutes: number
}

export interface WarmupSession {
  items: SessionItem[]
  /** The one being warmed now. */
  at: number
  /** Paused: the current timer is left as it is and nothing new starts. */
  paused: boolean
  /** How many were marked warmed in this session. */
  warmed: number
}

export function sessionItem(account: CampaignAccount, campaignName: string): SessionItem {
  return {
    accountId: account.id,
    platform: account.platform,
    handle: account.handle,
    campaignName,
    minutes: warmupMinutesFor(account),
  }
}

export function startSession(items: readonly SessionItem[]): WarmupSession | null {
  return items.length === 0 ? null : { items: [...items], at: 0, paused: false, warmed: 0 }
}

export function current(session: WarmupSession | null): SessionItem | null {
  return session ? (session.items[session.at] ?? null) : null
}

/** On to the next account - `warmed` when the one before was marked warmed,
 *  false when it was skipped. Null once there is no next: the session is
 *  over. */
export function advance(session: WarmupSession, warmed: boolean): WarmupSession | null {
  const next = { ...session, at: session.at + 1, warmed: session.warmed + (warmed ? 1 : 0) }
  return next.at >= next.items.length ? null : next
}

export function setPaused(session: WarmupSession, paused: boolean): WarmupSession {
  return { ...session, paused }
}

/** How many are left after the current one. */
export function remainingAfter(session: WarmupSession): number {
  return Math.max(0, session.items.length - session.at - 1)
}

/** Roughly how long a session of these takes, in minutes. */
export function sessionMinutes(items: readonly SessionItem[]): number {
  return items.reduce((sum, item) => sum + item.minutes, 0)
}

function valid(value: unknown): value is WarmupSession {
  const s = value as WarmupSession
  return (
    typeof s === 'object' &&
    s !== null &&
    Array.isArray(s.items) &&
    s.items.every((i) => i && typeof i.accountId === 'string' && typeof i.minutes === 'number' && typeof i.platform === 'string') &&
    typeof s.at === 'number' &&
    typeof s.paused === 'boolean' &&
    typeof s.warmed === 'number' &&
    s.at >= 0 &&
    s.at < s.items.length
  )
}

export function readSession(): WarmupSession | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    return valid(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function writeSession(session: WarmupSession | null): void {
  try {
    if (session === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  } catch {
    /* the session still runs for this visit; it just won't survive a reload */
  }
}
