// The planner's side of the cutter bridge: asks the `cutter-posted` Edge
// Function what the cutter has posted and ticks the Post grid for it
// (src/data/cutterBridge.ts). Browser code never reads the cutter's tables:
// the function does, and only for the user listed in its allow-list. For
// anyone else it answers `enabled: false` and everything here stays quiet.

import { useEffect, useState } from 'react'

import {
  applyCutterPosts,
  joinHandColumns,
  mergeSplitPosts,
  pruneRoster,
  redateCorrections,
  type AccountChange,
  type CutterPost,
  type CutterScheduled,
  type Roster,
  type UnmatchedAccount,
} from '../data/cutterBridge'
import { announceDataChanged } from '../data/changed'
import type { DataAdapter } from '../data'
import { getSupabaseClient } from './auth'

const SINCE_KEY = 'cutter-bridge-since'
const UNMATCHED_KEY = 'cutter-bridge-unmatched'
/** Read the last fortnight once more, from the start, once per value: posts
 *  an earlier version ticked on the wrong day are only put right when they
 *  come by again. Change the value to do it once more. */
const REREAD_KEY = 'cutter-bridge-reread'
const REREAD = '2026-10-23'
const REREAD_DAYS = 14
/** The fortnight's handles per campaign and platform (data/cutterBridge.ts
 *  Roster), and whether it was built from a whole fortnight's read. */
const ROSTER_KEY = 'cutter-bridge-roster'
const ROSTER_COMPLETE_KEY = 'cutter-bridge-roster-complete'
/** What the passes changed on his campaigns - an account added, a handle
 *  put right - for the Post screen to say, a few days each. */
const NOTICES_KEY = 'cutter-bridge-notices'
const NOTICE_DAYS = 3
/** As many posts as the function returns in one go (its own limit). */
const PAGE = 200
const EVERY_MS = 5 * 60 * 1000
/** Overlap between passes: a pass can be a little late, and ticking is
 *  idempotent, so looking back a bit more costs nothing. */
const OVERLAP_MS = 15 * 60 * 1000

async function call<T>(body: Record<string, unknown>): Promise<T | null> {
  const client = getSupabaseClient()
  if (!client) return null
  // Signed out there is no one to ask for: the function only answers a signed-in
  // user, so every pass was a refused request, every five minutes and on every
  // return to the app. getSession reads the stored session - no network.
  const { data: auth } = await client.auth.getSession()
  if (!auth.session) return null
  const { data, error } = await client.functions.invoke('cutter-posted', { body })
  if (error) return null
  return data as T
}

export interface CutterCampaign {
  id: string
  name: string
}

/** The cutter's campaigns for the link picker; null when the bridge is not
 *  available to this user. */
export async function listCutterCampaigns(): Promise<CutterCampaign[] | null> {
  const result = await call<{ enabled: boolean; campaigns: CutterCampaign[] }>({ action: 'campaigns' })
  return result?.enabled ? result.campaigns : null
}

function savedSince(): string | undefined {
  try {
    if (localStorage.getItem(REREAD_KEY) !== REREAD) return new Date(Date.now() - REREAD_DAYS * 24 * 60 * 60 * 1000).toISOString()
    return localStorage.getItem(SINCE_KEY) ?? undefined
  } catch {
    return undefined
  }
}

/** How long an account the cutter posted to is named under a campaign that
 *  doesn't have it: past that, the campaign has stopped posting there. */
const UNMATCHED_DAYS = 3

/** The cutter's accounts the last passes couldn't find in their campaigns,
 *  posted to in the last few days, for the Post screen to name. */
export function lastUnmatched(): UnmatchedAccount[] {
  try {
    const stored = JSON.parse(localStorage.getItem(UNMATCHED_KEY) ?? '[]') as unknown
    const since = Date.now() - UNMATCHED_DAYS * 24 * 60 * 60 * 1000
    return Array.isArray(stored) ? (stored as UnmatchedAccount[]).filter((u) => u.at !== undefined && Date.parse(u.at) >= since) : []
  } catch {
    return []
  }
}

function savedRoster(): Roster {
  try {
    const stored = JSON.parse(localStorage.getItem(ROSTER_KEY) ?? '{}') as unknown
    return pruneRoster(typeof stored === 'object' && stored !== null ? (stored as Roster) : {})
  } catch {
    return {}
  }
}

/** Changes the passes made to a campaign's accounts in the last few days,
 *  newest first, for the Post screen. */
export function recentChanges(campaignId: string): AccountChange[] {
  try {
    const stored = JSON.parse(localStorage.getItem(NOTICES_KEY) ?? '[]') as unknown
    const since = Date.now() - NOTICE_DAYS * 24 * 60 * 60 * 1000
    return Array.isArray(stored)
      ? (stored as AccountChange[]).filter((c) => c.campaignId === campaignId && Date.parse(c.at) >= since).reverse()
      : []
  } catch {
    return []
  }
}

/** One pass: fetch what was posted since the last, tick it. Returns how many
 *  boxes were ticked; 0 when the bridge is off or offline. */
export async function syncCutterPosts(data: DataAdapter): Promise<number> {
  const started = Date.now()
  const campaigns = await data.listCampaigns()
  const ids = campaigns.map((c) => c.cutter_campaign_id).filter((id): id is string => Boolean(id))
  if (ids.length === 0) return 0
  const since = savedSince()
  // A read that reaches back the whole fortnight builds a roster that can
  // tell a typo from another person's account (data/cutterBridge.ts).
  const wholeFortnight = since === undefined || Date.parse(since) <= started - (REREAD_DAYS - 1) * 24 * 60 * 60 * 1000
  const result = await call<{ enabled: boolean; posts: CutterPost[] }>({ action: 'posted', since, ids })
  if (!result?.enabled) return 0
  // What earlier versions left wrong: a post spread over a column per
  // account, and a post next to the column he ticked by hand for it.
  const merged = await mergeSplitPosts(data)
  const joined = await joinHandColumns(data)
  // And money those fixes took off today for other days' videos.
  const redated = await redateCorrections(data)
  const roster = savedRoster()
  let complete = wholeFortnight
  try {
    complete = complete || localStorage.getItem(ROSTER_COMPLETE_KEY) === 'true'
  } catch {
    /* a handle is only ever corrected from a whole fortnight's roster */
  }
  const { ticked, unmatched, added, renamed } = await applyCutterPosts(data, result.posts, roster, complete)
  // The screens read again: a box this pass ticked shows ticked now, not
  // after his next tap.
  if (merged + joined + redated + ticked + added.length + renamed.length > 0) announceDataChanged()
  // A full page means more are waiting: the next pass goes on from the last
  // one here, rather than from now and skipping them.
  const last = result.posts.at(-1)?.updatedAt
  const next = result.posts.length >= PAGE && last ? last : new Date(started - OVERLAP_MS).toISOString()
  try {
    localStorage.setItem(SINCE_KEY, next)
    localStorage.setItem(REREAD_KEY, REREAD)
    // Each account once, with the last time a post went to it.
    const key = (u: UnmatchedAccount) => `${u.campaignId}|${u.platform}|${u.handle}`
    const when = (u: UnmatchedAccount) => Date.parse(u.at ?? '') || 0
    const latest = new Map<string, UnmatchedAccount>()
    for (const u of [...lastUnmatched(), ...unmatched]) {
      const had = latest.get(key(u))
      if (!had || when(u) > when(had)) latest.set(key(u), u)
    }
    localStorage.setItem(UNMATCHED_KEY, JSON.stringify([...latest.values()].slice(-50)))
    localStorage.setItem(ROSTER_KEY, JSON.stringify(pruneRoster(roster)))
    if (complete) localStorage.setItem(ROSTER_COMPLETE_KEY, 'true')
    if (added.length + renamed.length > 0) {
      const stored = JSON.parse(localStorage.getItem(NOTICES_KEY) ?? '[]') as unknown
      const kept = Array.isArray(stored) ? (stored as AccountChange[]) : []
      localStorage.setItem(NOTICES_KEY, JSON.stringify([...kept, ...added, ...renamed].slice(-30)))
    }
  } catch {
    // Next pass looks back the default few days; ticking stays idempotent.
  }
  return ticked
}

/** What the cutter has scheduled in the next two days, every campaign - the
 *  grid keeps the linked ones, and names the rest so he can add them. Null
 *  when the bridge is off for this user or unreachable. */
export async function fetchCutterScheduled(): Promise<CutterScheduled[] | null> {
  const result = await call<{ enabled: boolean; posts: CutterScheduled[] }>({ action: 'scheduled' })
  return result?.enabled && Array.isArray(result.posts) ? result.posts : null
}

/** The cutter's scheduled posts, kept fresh while the screen is open: on
 *  opening, on coming back to it, and every few minutes. Empty when the
 *  bridge is off - the grid then simply has no blue boxes. */
export function useCutterScheduled(refresh = 0): CutterScheduled[] {
  const [posts, setPosts] = useState<CutterScheduled[]>([])
  useEffect(() => {
    let stopped = false
    const run = () => {
      if (stopped || document.visibilityState !== 'visible') return
      void fetchCutterScheduled()
        .then((found) => {
          if (!stopped && found) setPosts(found)
        })
        .catch(() => {})
    }
    run()
    const timer = window.setInterval(run, EVERY_MS)
    document.addEventListener('visibilitychange', run)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', run)
    }
  }, [refresh])
  return posts
}

/** Runs a pass when the app opens, when it comes back, and every few minutes. */
export function useCutterBridge(data: DataAdapter, ready: boolean): void {
  useEffect(() => {
    if (!ready) return
    let stopped = false
    const run = () => {
      if (stopped || document.visibilityState !== 'visible') return
      void syncCutterPosts(data).catch(() => {
        // Nothing is lost: the next pass looks again.
      })
    }
    run()
    const timer = window.setInterval(run, EVERY_MS)
    document.addEventListener('visibilitychange', run)
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', run)
    }
  }, [data, ready])
}
