// The hook generator Edge Function. Contract: docs/EDGE_FUNCTION.md.
//
// Calls the model API server-side (the key must never reach the browser),
// requires a valid session, and asks for hooks built only from the campaign
// material the client sends it. Like parse-campaign, this function writes
// nothing to the database: it generates and returns, and the client decides
// what to keep.
//
// Why the client sends the material rather than the function reading it: the
// app is local-first and the campaign already lives on the device. Having the
// function query Postgres for it would make it the second place that knows how
// a campaign is shaped, free to drift from src/data - the same reasoning that
// kept SupabaseAdapter out of the design (docs/SYNC.md).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  HOOK_SYSTEM_PROMPT,
  RETURN_HOOKS_SCHEMA,
  buildHookRequest,
  dropUnknownAngles,
  type GenerateHooksResult,
  type HookContext,
} from '../_shared/hookPrompt.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const MODEL = Deno.env.get('GENERATE_HOOKS_MODEL') ?? 'claude-haiku-4-5-20251001'

/** Hooks are short and there are never many. Capped so a runaway response
 *  cannot cost more than the job is worth. */
const MAX_TOKENS = 2000

/** More than this and he is not working down a list, he is reading a wall. */
const MAX_HOOKS = 20

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

async function callModel(context: HookContext): Promise<GenerateHooksResult> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: HOOK_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildHookRequest(context) }],
      tools: [
        {
          name: 'return_hooks',
          description: 'Return the hooks you wrote.',
          input_schema: RETURN_HOOKS_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: 'return_hooks' },
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Model API returned ${response.status}: ${detail}`)
  }

  const body = await response.json()
  const toolUse = (body.content ?? []).find((block: { type: string }) => block.type === 'tool_use')
  if (!toolUse) throw new Error('Model did not return a tool call.')

  return toolUse.input as GenerateHooksResult
}

/** The request body, checked rather than trusted. A malformed context would
 *  otherwise reach the prompt as the string "undefined" and be answered with
 *  confident nonsense. */
function readContext(body: unknown): HookContext | string {
  if (typeof body !== 'object' || body === null) return 'Body must be a JSON object.'
  const raw = body as Record<string, unknown>

  if (typeof raw.campaignName !== 'string' || raw.campaignName.trim() === '') {
    return 'campaignName is required.'
  }
  const count = Number(raw.count)
  if (!Number.isInteger(count) || count < 1) return 'count must be a whole number of at least 1.'

  const angles = Array.isArray(raw.angles) ? raw.angles : []
  const rules = Array.isArray(raw.rules) ? raw.rules.filter((r) => typeof r === 'string') : []

  return {
    campaignName: raw.campaignName,
    company: typeof raw.company === 'string' ? raw.company : null,
    productFacts: typeof raw.productFacts === 'string' ? raw.productFacts : null,
    audience: typeof raw.audience === 'string' ? raw.audience : null,
    tone: typeof raw.tone === 'string' ? raw.tone : null,
    structure: typeof raw.structure === 'string' ? raw.structure : null,
    rules: rules as string[],
    angles: angles.map((angle) => {
      const a = angle as Record<string, unknown>
      return {
        id: String(a.id ?? ''),
        label: String(a.label ?? ''),
        body: typeof a.body === 'string' ? a.body : null,
        family: typeof a.family === 'string' ? a.family : null,
      }
    }),
    lastFamily: typeof raw.lastFamily === 'string' ? raw.lastFamily : null,
    // Capped rather than refused: asking for 50 is a slip, not an error worth
    // failing his session over.
    count: Math.min(count, MAX_HOOKS),
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse({ error: 'POST only.' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonResponse({ error: 'Missing Authorization header.' }, 401)

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) return jsonResponse({ error: 'Invalid or expired session.' }, 401)

  let parsed: unknown
  try {
    parsed = await req.json()
  } catch {
    return jsonResponse({ error: 'Body must be JSON.' }, 400)
  }

  const context = readContext(parsed)
  if (typeof context === 'string') return jsonResponse({ error: context }, 400)

  let result: GenerateHooksResult
  try {
    result = await callModel(context)
  } catch (err) {
    return jsonResponse({ error: `Hook generation failed: ${(err as Error).message}` }, 502)
  }

  // A model told to pick an angle id from a list will occasionally return one
  // that is not in it. Dropped rather than reassigned: a hook filed under a
  // storyline nobody chose is worse than one with no angle.
  return jsonResponse(dropUnknownAngles(result, context.angles))
})
