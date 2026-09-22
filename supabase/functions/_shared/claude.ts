// What both Edge Functions share: the session check, CORS, and one call to
// Claude that returns JSON matching a schema.
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
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!

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

/** Refuses anything but a signed-in POST. Both functions spend money per
 *  call, so neither is an open endpoint. Returns the response to send when
 *  the request is refused, or null when it may go ahead. */
export async function refuseUnlessSignedIn(req: Request): Promise<Response | null> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse({ error: 'POST only.' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonResponse({ error: 'Missing Authorization header.' }, 401)

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return jsonResponse({ error: 'Invalid or expired session.' }, 401)
  return null
}

export class ModelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelError'
  }
}

export interface JsonCall {
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
      'x-api-key': ANTHROPIC_API_KEY,
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
    throw new ModelError(`Model API returned ${response.status}: ${detail}`)
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
