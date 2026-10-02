// What the Edge Functions share: the session check, CORS, the per-user key
// lookup, and one call to Claude that returns JSON matching a schema.
//
// Bring-your-own-key: there is no project-wide model key any more. Every model
// call uses the signed-in user's own key, decrypted server-side from Supabase
// Vault (docs/migrations/0015_ai_keys.sql) for exactly one request and never
// returned to the browser.
//
// Server-only, and hand-written - unlike verify.ts and hookPrompt.ts, nothing
// in src/ has a copy of this, so there is nothing for it to drift from.
//
// Structured outputs (`output_config.format`) rather than a forced tool call.
// A forced tool call was the old way to get JSON back, and the schema it
// carried was only a hint: both functions grew code to survive a model that
// left out a required array or returned a number where a string was asked
// for. A JSON-schema format is enforced by the API, so the shape is
// guaranteed. It also keeps working on newer models, which reject forced
// tool choice outright.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

/** Why an AI call failed, in terms the app can act on. The browser maps each
 *  code to a plain sentence (src/ai/errors.ts); `error` stays human-readable
 *  for anything that only shows the message. */
export type AiErrorCode = 'no_key' | 'invalid_key' | 'rate_limited' | 'model_error'

const STATUS_FOR_CODE: Record<AiErrorCode, number> = {
  no_key: 412,
  // Not 401: that already means "your session is bad" on these functions.
  invalid_key: 422,
  rate_limited: 429,
  model_error: 502,
}

export class ModelError extends Error {
  readonly code: AiErrorCode
  readonly retryAfterSeconds: number | null
  constructor(message: string, code: AiErrorCode = 'model_error', retryAfterSeconds: number | null = null) {
    super(message)
    this.name = 'ModelError'
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/** The response for a failed AI call: `{ error, code, retry_after_seconds? }`. */
export function errorResponse(err: unknown, prefix = ''): Response {
  if (err instanceof ModelError) {
    return jsonResponse(
      { error: `${prefix}${err.message}`, code: err.code, retry_after_seconds: err.retryAfterSeconds },
      STATUS_FOR_CODE[err.code],
    )
  }
  return jsonResponse({ error: `${prefix}${(err as Error).message}`, code: 'model_error' }, 502)
}

/** Maps a non-2xx from the model API onto an AiErrorCode. Shared by the call
 *  itself and by the key check made when a key is saved. */
export function modelErrorFor(status: number, detail: string, retryAfter: string | null): ModelError {
  if (status === 401 || status === 403) {
    return new ModelError('Anthropic rejected this API key.', 'invalid_key')
  }
  if (status === 429) {
    const seconds = retryAfter !== null && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null
    return new ModelError('Anthropic is rate limiting this key.', 'rate_limited', seconds)
  }
  return new ModelError(`Model API returned ${status}: ${detail}`)
}

export interface SignedIn {
  userId: string
}

/** Refuses anything but a signed-in POST. These functions spend the user's
 *  money per call, so none is an open endpoint. Returns the response to send
 *  when the request is refused, or the verified user id.
 *
 *  The id comes from the session token, never from the request body: it is
 *  what selects whose key gets decrypted. */
export async function requireUser(req: Request): Promise<Response | SignedIn> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse({ error: 'POST only.' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonResponse({ error: 'Missing Authorization header.' }, 401)

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return jsonResponse({ error: 'Invalid or expired session.' }, 401)
  return { userId: data.user.id }
}

/** Service-role client, for the vault functions only. Never handed anything
 *  the caller controls except through the verified user id. */
export function serviceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}

/** This user's decrypted key for a provider. Throws ModelError('no_key') when
 *  none is saved. Held in memory for the one request. */
export async function loadUserKey(userId: string, provider = 'anthropic'): Promise<string> {
  const { data, error } = await serviceClient().rpc('get_ai_key', {
    p_user: userId,
    p_provider: provider,
  })
  if (error) throw new ModelError(`Could not read your saved key: ${error.message}`)
  if (typeof data !== 'string' || data === '') {
    throw new ModelError('No API key saved. Add your Anthropic key in Setup.', 'no_key')
  }
  return data
}

export interface JsonCall {
  /** The caller's own key, from loadUserKey. */
  apiKey: string
  model: string
  system: string
  user: string
  schema: Record<string, unknown>
  /** Thinking depth. Both jobs are well-specified single calls, where the
   *  lower levels are strong and much faster - he is waiting on a phone. */
  effort: 'low' | 'medium' | 'high'
  maxTokens: number
}

export interface JsonAnswer<T> {
  data: T
  /** The model that actually wrote the answer. Usually the one asked for; a
   *  different one when a safety classifier declined and the request was
   *  rerouted. Anything generated records this, never the model requested. */
  model: string
}

/** One request, JSON back, or a ModelError saying plainly what went wrong. */
export async function callForJson<T>(call: JsonCall): Promise<JsonAnswer<T>> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': call.apiKey,
      'anthropic-version': '2023-06-01',
      // A request a safety classifier declines is re-run server-side on the
      // recommended fallback model rather than coming back as a refusal. These
      // are campaign briefs and hooks, so that should essentially never
      // happen - but when a classifier misfires, he gets an answer instead
      // of a dead button.
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: call.model,
      max_tokens: call.maxTokens,
      fallbacks: 'default',
      system: call.system,
      messages: [{ role: 'user', content: call.user }],
      output_config: {
        effort: call.effort,
        format: { type: 'json_schema', schema: call.schema },
      },
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw modelErrorFor(response.status, detail, response.headers.get('retry-after'))
  }

  const body = await response.json()

  // Checked before the content is read: a refusal is an HTTP 200 whose
  // content is empty or partial.
  if (body.stop_reason === 'refusal') {
    throw new ModelError('The model declined this request.')
  }
  if (body.stop_reason === 'max_tokens') {
    throw new ModelError('The answer ran out of room before it finished. Try shorter documents.')
  }

  const text = [...(body.content ?? [])]
    .reverse()
    .find((block: { type: string }) => block.type === 'text') as { text: string } | undefined
  if (!text) throw new ModelError('The model returned no answer.')

  try {
    return { data: JSON.parse(text.text) as T, model: String(body.model ?? call.model) }
  } catch {
    throw new ModelError('The model returned something that is not JSON.')
  }
}

/** A nullable JSON-schema type, in the form structured outputs accepts. */
export function nullable(schema: Record<string, unknown>): Record<string, unknown> {
  return { anyOf: [schema, { type: 'null' }] }
}
