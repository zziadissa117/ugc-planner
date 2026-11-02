// Invite links: the only way a new account gets made.
//
//   POST { action: 'list' }                 -> { enabled, links: [InviteLink] }
//   POST { action: 'create', maxUses }      -> { link: InviteLink }
//   POST { action: 'switch_off', id }       -> { link: InviteLink }
//
// The check itself is not here - it runs on the auth.users insert
// (docs/migrations/0021_invite_links.sql), so no route around this function
// gets past it. This only lets him make links, see who came in through each,
// and switch one off.
//
// Owner only (_shared/owner.ts). Anyone else gets `enabled: false` and
// nothing, the same way planner-postiz answers, so a student's SETUP has no
// invite section rather than a broken one.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { jsonResponse, requireUser, serviceClient } from '../_shared/claude.ts'
import { isOwner } from '../_shared/owner.ts'

/** Generous for one class, small enough that a typo cannot open the doors. */
const MAX_USES_LIMIT = 200

interface InviteLink {
  id: string
  code: string
  max_uses: number
  created_at: string
  switched_off_at: string | null
  joined: { email: string | null; joined_at: string }[]
}

/** 128 random bits, URL-safe. Long enough that guessing one is not a plan. */
function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const LINK_COLUMNS = 'id, code, max_uses, created_at, switched_off_at, invite_uses(email, joined_at)'

type LinkRow = Omit<InviteLink, 'joined'> & { invite_uses: InviteLink['joined'] | null }

function toLink(row: LinkRow): InviteLink {
  const { invite_uses, ...link } = row
  const joined = [...(invite_uses ?? [])].sort((a, b) => a.joined_at.localeCompare(b.joined_at))
  return { ...link, joined }
}

Deno.serve(async (req: Request) => {
  const auth = await requireUser(req)
  if (auth instanceof Response) return auth
  if (!isOwner(auth.userId)) return jsonResponse({ enabled: false, links: [] })

  let body: { action?: unknown; maxUses?: unknown; id?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Body must be JSON.' }, 400)
  }

  const db = serviceClient()

  if (body.action === 'list') {
    const { data, error } = await db
      .from('invite_links')
      .select(LINK_COLUMNS)
      .order('created_at', { ascending: false })
    if (error) return jsonResponse({ error: error.message }, 500)
    return jsonResponse({ enabled: true, links: (data as LinkRow[]).map(toLink) })
  }

  if (body.action === 'create') {
    const maxUses = body.maxUses
    if (typeof maxUses !== 'number' || !Number.isInteger(maxUses) || maxUses < 1 || maxUses > MAX_USES_LIMIT) {
      return jsonResponse({ error: `How many people: a whole number from 1 to ${MAX_USES_LIMIT}.` }, 400)
    }
    const { data, error } = await db
      .from('invite_links')
      .insert({ code: newCode(), max_uses: maxUses, created_by: auth.userId })
      .select(LINK_COLUMNS)
      .single()
    if (error) return jsonResponse({ error: 'Could not make the link.' }, 500)
    return jsonResponse({ link: toLink(data as LinkRow) })
  }

  if (body.action === 'switch_off') {
    const id = typeof body.id === 'string' ? body.id : ''
    if (id === '') return jsonResponse({ error: 'id is required.' }, 400)
    const { data, error } = await db
      .from('invite_links')
      .update({ switched_off_at: new Date().toISOString() })
      .eq('id', id)
      .is('switched_off_at', null)
      .select(LINK_COLUMNS)
      .maybeSingle()
    if (error) return jsonResponse({ error: 'Could not switch the link off.' }, 500)
    if (!data) return jsonResponse({ error: 'That link is already off or does not exist.' }, 404)
    return jsonResponse({ link: toLink(data as LinkRow) })
  }

  return jsonResponse({ error: 'action must be list, create or switch_off.' }, 400)
})
