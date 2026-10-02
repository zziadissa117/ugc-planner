// Bring-your-own-key, client side.
//
// The key itself only ever travels one way: from the paste box to the `ai-key`
// Edge Function, which checks it with the provider and stores it encrypted.
// Nothing here can read a key back - the server returns the last four
// characters and nothing else - and nothing here writes one to Dexie, the
// outbox, localStorage or the export. It is online-only by nature: there is
// nothing to save a key *to* without a server, and the AI features need one.

import { getSupabaseClient } from '../sync/auth'
import { AiError, toAiError } from './errors'

export type AiProvider = 'anthropic'

/** Providers the UI offers. Another is one entry here plus one in
 *  supabase/functions/ai-key. */
export const AI_PROVIDERS: readonly { id: AiProvider; label: string; placeholder: string }[] = [
  { id: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-...' },
]

export interface SavedKey {
  provider: string
  last4: string
  updated_at: string
}

/** "sk-ant-...abcd" - what is shown for a saved key. Only the last four
 *  characters exist on the client, so this is the most it could ever show. */
export function maskKey(last4: string): string {
  return `••••••••${last4}`
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const client = getSupabaseClient()
  if (!client) throw new AiError('Sign-in is not configured, so keys cannot be saved.')
  const { data, error } = await client.functions.invoke('ai-key', { body })
  if (error) throw await toAiError(error)
  return data as T
}

export async function listKeys(): Promise<SavedKey[]> {
  const { keys } = await call<{ keys: SavedKey[] }>({ action: 'status' })
  return keys
}

export async function saveKey(provider: AiProvider, key: string): Promise<SavedKey> {
  const { last4 } = await call<{ provider: string; last4: string }>({ action: 'save', provider, key })
  return { provider, last4, updated_at: new Date().toISOString() }
}

export async function removeKey(provider: AiProvider): Promise<void> {
  await call({ action: 'remove', provider })
}
