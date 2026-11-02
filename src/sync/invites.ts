// The planner's call to its `invites` function: make an invite link, see who
// came in through each, switch one off. Owner only - for anyone else the
// function answers `enabled: false` and this returns null, so nothing is shown.
// Online-only by nature: a link exists on the server or not at all.

import { toAiError } from '../ai/errors'
import { getSupabaseClient } from './auth'

export interface InviteLink {
  id: string
  code: string
  max_uses: number
  created_at: string
  switched_off_at: string | null
  joined: { email: string | null; joined_at: string }[]
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const client = getSupabaseClient()
  if (!client) throw new Error('Sign-in is not configured.')
  const { data, error } = await client.functions.invoke('invites', { body })
  if (error) throw new Error((await toAiError(error)).message)
  return data as T
}

export async function listInvites(): Promise<InviteLink[] | null> {
  const answer = await call<{ enabled?: unknown; links?: unknown }>({ action: 'list' })
  return answer.enabled === true && Array.isArray(answer.links) ? (answer.links as InviteLink[]) : null
}

export async function createInvite(maxUses: number): Promise<InviteLink> {
  const { link } = await call<{ link: InviteLink }>({ action: 'create', maxUses })
  return link
}

export async function switchOffInvite(id: string): Promise<InviteLink> {
  const { link } = await call<{ link: InviteLink }>({ action: 'switch_off', id })
  return link
}

/** The address a student opens. Built from wherever he is using the app, the
 *  same origin the magic link returns to. */
export function inviteUrl(code: string): string {
  return `${window.location.origin}/join/${code}`
}

export function isOpen(link: InviteLink): boolean {
  return link.switched_off_at === null && link.joined.length < link.max_uses
}
