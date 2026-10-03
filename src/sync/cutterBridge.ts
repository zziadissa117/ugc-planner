// The planner's side of the cutter bridge: asks the `cutter-posted` Edge
// Function what the cutter has posted and ticks the Post grid for it
// (src/data/cutterBridge.ts). Browser code never reads the cutter's tables:
// the function does, and only for the user listed in its allow-list. For
// anyone else it answers `enabled: false` and everything here stays quiet.

import { useEffect } from 'react'

import { applyCutterPosts, type CutterPost } from '../data/cutterBridge'
import type { DataAdapter } from '../data'
import { getSupabaseClient } from './auth'

const SINCE_KEY = 'cutter-bridge-since'
const EVERY_MS = 5 * 60 * 1000
/** Overlap between passes: a pass can be a little late, and ticking is
 *  idempotent, so looking back a bit more costs nothing. */
const OVERLAP_MS = 15 * 60 * 1000

async function call<T>(body: Record<string, unknown>): Promise<T | null> {
  const client = getSupabaseClient()
  if (!client) return null
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
    return localStorage.getItem(SINCE_KEY) ?? undefined
  } catch {
    return undefined
  }
}

/** One pass: fetch what was posted since the last, tick it. Returns how many
 *  boxes were ticked; 0 when the bridge is off or offline. */
export async function syncCutterPosts(data: DataAdapter): Promise<number> {
  const started = Date.now()
  const campaigns = await data.listCampaigns()
  const ids = campaigns.map((c) => c.cutter_campaign_id).filter((id): id is string => Boolean(id))
  if (ids.length === 0) return 0
  const result = await call<{ enabled: boolean; posts: CutterPost[] }>({ action: 'posted', since: savedSince(), ids })
  if (!result?.enabled) return 0
  const ticked = await applyCutterPosts(data, result.posts)
  try {
    localStorage.setItem(SINCE_KEY, new Date(started - OVERLAP_MS).toISOString())
  } catch {
    // Next pass looks back the default few days; ticking stays idempotent.
  }
  return ticked
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
