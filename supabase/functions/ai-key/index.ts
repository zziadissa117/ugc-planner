// Bring-your-own-key management. Contract: docs/EDGE_FUNCTION.md.
//
//   POST { action: 'status' }                           -> { keys: [{ provider, last4, updated_at }] }
//   POST { action: 'save', provider, key }              -> { provider, last4 }
//   POST { action: 'remove', provider }                 -> { provider, removed }
//
// The full key is accepted here and never returned: not on save, not on
// status, not in an error. Only the last four characters leave the server.
//
// A key is checked against the provider before it is stored, so "invalid key"
// is reported when he pastes it, not later in the middle of parsing a
// contract. The check is a list-models call, which spends no tokens.
//
// All writes go through service-role-only SQL functions
// (docs/migrations/0015_ai_keys.sql); the browser has no write grant on the
// table. The user id is taken from the verified session, never from the body.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { ModelError, errorResponse, jsonResponse, modelErrorFor, requireUser, serviceClient } from '../_shared/claude.ts'

/** Providers that can hold a key, and how to check one. Adding a provider is
 *  an entry here plus whatever function calls it - no migration. */
const PROVIDERS: Record<
  string,
  { label: string; prefix: string; looksValid: (key: string) => boolean; verify: (key: string) => Promise<void> }
> = {
  anthropic: {
    label: 'Anthropic',
    prefix: 'sk-ant-',
    looksValid: (key) => /^sk-ant-[A-Za-z0-9_-]{16,}$/.test(key),
    async verify(key) {
      const response = await fetch('https://api.anthropic.com/v1/models?limit=1', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      })
      if (response.ok) return
      // A rate-limited key is still a valid key: refusing to save it would
      // report a working key as broken.
      if (response.status === 429) return
      throw modelErrorFor(response.status, await response.text(), response.headers.get('retry-after'))
    },
  },
}

Deno.serve(async (req: Request) => {
  const auth = await requireUser(req)
  if (auth instanceof Response) return auth

  let body: { action?: unknown; provider?: unknown; key?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Body must be JSON.' }, 400)
  }

  const db = serviceClient()

  if (body.action === 'status') {
    const { data, error } = await db
      .from('user_ai_keys')
      .select('provider, key_last4, updated_at')
      .eq('user_id', auth.userId)
    if (error) return jsonResponse({ error: error.message }, 500)
    return jsonResponse({
      keys: (data ?? []).map((row) => ({
        provider: row.provider,
        last4: row.key_last4,
        updated_at: row.updated_at,
      })),
    })
  }

  const provider = typeof body.provider === 'string' ? body.provider : ''
  const handler = PROVIDERS[provider]
  if (!handler) return jsonResponse({ error: `Unknown provider: ${provider || '(none)'}.` }, 400)

  if (body.action === 'save') {
    const key = typeof body.key === 'string' ? body.key.trim() : ''
    if (key === '') return jsonResponse({ error: 'Paste your API key first.' }, 400)
    if (!handler.looksValid(key)) {
      return errorResponse(new ModelError(`That doesn't look like a ${handler.label} API key (it starts with ${handler.prefix}).`, 'invalid_key'))
    }
    try {
      await handler.verify(key)
    } catch (err) {
      return errorResponse(err)
    }
    const { data, error } = await db.rpc('save_ai_key', {
      p_user: auth.userId,
      p_provider: provider,
      p_key: key,
    })
    if (error) return jsonResponse({ error: 'Could not save the key.' }, 500)
    return jsonResponse({ provider, last4: data as string })
  }

  if (body.action === 'remove') {
    const { data, error } = await db.rpc('delete_ai_key', { p_user: auth.userId, p_provider: provider })
    if (error) return jsonResponse({ error: 'Could not remove the key.' }, 500)
    return jsonResponse({ provider, removed: data as boolean })
  }

  return jsonResponse({ error: 'action must be status, save or remove.' }, 400)
})
