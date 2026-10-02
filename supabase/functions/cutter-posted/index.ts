// Tells the planner what the cutter app has posted, so its Post grid can tick
// itself. Design: the cutter repo's docs/PLANNER_BRIDGE_PROPOSAL.md.
//
//   POST { action: 'campaigns' }                        -> { enabled, campaigns: [{ id, name }] }
//   POST { action: 'posted', since?: ISO, ids?: [id] }  -> { enabled, posts: [...] }
//
// The cutter's tables are server-only on purpose, so the browser never reads
// them: this function does, with the service role, and only for the planner
// users listed in CUTTER_BRIDGE_USER_IDS (comma separated user ids). Anyone
// else signed in gets `enabled: false` and nothing - the other people the
// planner is shared with never see these posts.
//
// A post is reported only when the cutter's own status is 'posted' (Postiz
// confirmed it went out). Scheduled is not posted. A repost of an earlier
// video (repost_of set) is left out so one deliverable is never paid twice.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { jsonResponse, requireUser, serviceClient } from '../_shared/claude.ts'

const DAY_MS = 24 * 60 * 60 * 1000

Deno.serve(async (req: Request) => {
  const auth = await requireUser(req)
  if (auth instanceof Response) return auth

  const allowed = (Deno.env.get('CUTTER_BRIDGE_USER_IDS') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  if (!allowed.includes(auth.userId)) return jsonResponse({ enabled: false, campaigns: [], posts: [] })

  let body: { action?: unknown; since?: unknown; ids?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Body must be JSON.' }, 400)
  }
  const db = serviceClient()

  if (body.action === 'campaigns') {
    const { data, error } = await db
      .from('cutter_posts')
      .select('campaign_id, campaign_name, created_at')
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) return jsonResponse({ error: 'Could not read the cutter campaigns.' }, 502)
    const seen = new Map<string, string>()
    for (const row of data ?? []) if (!seen.has(row.campaign_id)) seen.set(row.campaign_id, row.campaign_name)
    return jsonResponse({ enabled: true, campaigns: [...seen].map(([id, name]) => ({ id, name })) })
  }

  if (body.action === 'posted') {
    const since =
      typeof body.since === 'string' && !Number.isNaN(Date.parse(body.since))
        ? body.since
        : new Date(Date.now() - 3 * DAY_MS).toISOString()
    const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string').slice(0, 100) : []
    let query = db
      .from('cutter_posts')
      .select('id, campaign_id, campaign_name, accounts, release_urls, post_at, updated_at')
      .eq('status', 'posted')
      .is('repost_of', null)
      .gte('updated_at', since)
      .order('updated_at', { ascending: true })
      .limit(200)
    if (ids.length > 0) query = query.in('campaign_id', ids)
    const { data, error } = await query
    if (error) return jsonResponse({ error: 'Could not read the posted videos.' }, 502)
    return jsonResponse({
      enabled: true,
      posts: (data ?? []).map((p) => ({
        id: p.id,
        campaignId: p.campaign_id,
        campaignName: p.campaign_name,
        accounts: ((p.accounts ?? []) as { name: string; platform: string; held?: string }[])
          .filter((a) => !a.held)
          .map((a) => ({ name: a.name, platform: a.platform })),
        links: p.release_urls ?? {},
        postedAt: p.post_at ?? p.updated_at,
      })),
    })
  }

  return jsonResponse({ error: 'Unknown action.' }, 400)
})
