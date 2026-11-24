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
// contract. For Anthropic the check is a list-models call, which spends no
// tokens; for Postiz it lists the accounts (one of the key's 30 requests an
// hour). Removing the Postiz key also drops what was read with it
// (postiz_posts, postiz_state - docs/POSTIZ_AND_COACH.md).
//
// All writes go through service-role-only SQL functions
// (docs/migrations/0015_ai_keys.sql); the browser has no write grant on the
// table. The user id is taken from the verified session, never from the body.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { ModelError, errorResponse, jsonResponse, modelErrorFor, requireUser, serviceClient } from '../_shared/claude.ts'
import { forgetPostiz } from '../_shared/postizPosts.ts'
import { POSTIZ_API, postizMessage } from '../_shared/postizRules.ts'

/** Providers that can hold a key, and how to check one. Adding a provider is
 *  an entry here plus whatever function calls it - no migration. */
const PROVIDERS: Record<
  string,
  { label: string; shape: string; looksValid: (key: string) => boolean; verify: (key: string) => Promise<void> }
> = {
  anthropic: {
    label: 'Anthropic',
    shape: 'it starts with sk-ant-',
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
  // A student's own Postiz, for their posts' links, previews and views
  // (`postiz-posts`, `coach`). Postiz has two kinds of key: the Public API
  // key from Settings (hex) and an OAuth app token (starts pos_). The cutter
  // takes any non-empty key and lets Postiz decide, so the shape check here
  // only turns away what cannot be a key at all - spaces, a pasted sentence.
  postiz: {
    label: 'Postiz',
    shape: 'copy it from Postiz: Settings, then Public API',
    looksValid: (key) => /^[\x21-\x7e]{16,500}$/.test(key),
    async verify(key) {
      let response: Response
      try {
        response = await fetch(`${POSTIZ_API}/integrations`, {
          headers: { Authorization: key },
          signal: AbortSignal.timeout(20_000),
        })
      } catch (error) {
        throw new ModelError(`Postiz could not be reached (${(error as Error).message}). Try again in a minute.`)
      }
      if (response.ok) return
      // Too many requests this hour is still a working key.
      if (response.status === 429) return
      const said = postizMessage(await response.json().catch(() => null))
      if (response.status === 401 || response.status === 403) {
        throw new ModelError(
          said && /subscription/i.test(said)
            ? 'Postiz says this account has no subscription, so its API cannot be used.'
            : "Postiz didn't accept this key. In Postiz, open Settings, then Public API, and copy it again.",
          'invalid_key',
        )
      }
      throw new ModelError(`Postiz answered ${response.status}${said ? `: ${said}` : ''}. Try again in a minute.`)
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
      return errorResponse(new ModelError(`That doesn't look like a ${handler.label} API key (${handler.shape}).`, 'invalid_key'))
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
    if (provider === 'postiz') await forgetPostiz(auth.userId).catch(() => {})
    return jsonResponse({ provider, removed: data as boolean })
  }

  return jsonResponse({ error: 'action must be status, save or remove.' }, 400)
})
