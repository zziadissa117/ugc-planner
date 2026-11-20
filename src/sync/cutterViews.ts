// Reads a campaign's posts and their views from the `cutter-posted` function -
// display only. Nothing here writes to the store or touches the Post grid: he
// ticks every box himself (CLAUDE.md). Owner only on the server; anyone else
// gets `enabled: false`.

import type { CutterViewsPost } from '../data/campaignViews'
import { getSupabaseClient } from './auth'

/** The function's own page size. */
const PAGE = 200

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const client = getSupabaseClient()
  if (!client) throw new Error('Sign-in is not configured.')
  const { data: auth } = await client.auth.getSession()
  if (!auth.session) throw new Error('Sign in to see views.')
  const { data, error } = await client.functions.invoke('cutter-posted', { body })
  if (error) throw new Error('Could not reach the cutter for views. Check the connection and try again.')
  return data as T
}

export async function listCutterCampaigns(): Promise<{ id: string; name: string }[] | null> {
  const answer = await call<{ enabled?: boolean; campaigns?: { id: string; name: string }[] }>({ action: 'campaigns' })
  return answer.enabled ? (answer.campaigns ?? []) : null
}

/** Every posted video of one cutter campaign updated since `since`, paged by
 *  the function's 200 at a time. Null when the cutter is not his to read. */
export async function fetchCutterViews(cutterCampaignId: string, since: string): Promise<CutterViewsPost[] | null> {
  const byId = new Map<string, CutterViewsPost>()
  let from = since
  for (let page = 0; page < 20; page++) {
    const answer = await call<{
      enabled?: boolean
      posts?: (CutterViewsPost & { updatedAt: string })[]
    }>({ action: 'posted', since: from, ids: [cutterCampaignId] })
    if (!answer.enabled) return null
    const posts = answer.posts ?? []
    for (const post of posts) byId.set(post.id, post)
    const last = posts.at(-1)?.updatedAt
    if (posts.length < PAGE || !last || last === from) break
    from = last
  }
  return [...byId.values()]
}
