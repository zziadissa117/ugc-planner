// The parser Edge Function. Contract: docs/EDGE_FUNCTION.md.
//
// Calls the model API server-side (the key must never reach the browser),
// requires a valid session, asks for structured JSON with a source_quote on
// every field, then runs the vendored verifyQuotes against the uploaded text
// before returning anything - a field survives only if the model's own quote
// can still be found verbatim in the document it claims to come from. This
// function writes nothing to the database; it parses and returns.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyQuotes } from '../_shared/verify.ts'
import { NEVER_PARSED_FIELDS, type ParseResult } from '../_shared/parserTypes.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!
const MODEL = Deno.env.get('PARSE_CAMPAIGN_MODEL') ?? 'claude-haiku-4-5-20251001'

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

// The strict schema the model must fill. Every extracted field is
// { value, source_quote, from? } - never a bare value - so a quote can never
// be added after the fact. approval_mode is left out of the campaign object
// on purpose: SPEC section 7 treats it as a reviewable field like any other.
const PARSE_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    campaign: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        company: { type: ['string', 'null'] },
        approval_mode: {
          type: ['string', 'null'],
          enum: ['none', 'video', 'script_and_video', 'brand_scripted', null],
        },
      },
      required: ['name', 'company', 'approval_mode'],
    },
    fields: {
      type: 'object',
      description:
        'Keyed by field_key. Every value present must carry the exact source_quote it was read from.',
      additionalProperties: {
        type: 'object',
        properties: {
          value: { type: ['string', 'null'] },
          source_quote: { type: ['string', 'null'] },
          from: { type: ['string', 'null'], enum: ['brief', 'contract', null] },
        },
        required: ['value', 'source_quote'],
      },
    },
    bonus_tiers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          threshold_views: { type: 'integer' },
          payout_cents: {
            type: 'integer',
            description: 'Integer cents. $50.00 is 5000. Never a float, never a dollar string.',
          },
          view_window_days: { type: ['integer', 'null'] },
        },
        required: ['label', 'threshold_views', 'payout_cents', 'view_window_days'],
      },
    },
    rules: { type: 'array', items: { type: 'string' } },
    brief_is_incomplete: { type: 'boolean' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['campaign', 'fields', 'bonus_tiers', 'rules', 'brief_is_incomplete', 'warnings'],
} as const

const SYSTEM_PROMPT = `You extract fields from a UGC creator's brand contract and brief. Three rules override everything else:

1. Return null for anything the documents do not state. Absence is a valid, expected, common answer. Never infer, never complete a pattern, never fill a gap from general knowledge of how such contracts usually read.
2. Every field you return with a non-null value must carry source_quote: the exact substring you read it from, copied verbatim from the document, not paraphrased or tidied.
3. Never guess a value in order to have something to return. A blank is correct; a plausible number is the worst possible answer, because nothing downstream can tell it apart from a real one.

Contracts are templated (SideShift). Parse these with high confidence when present:
- pay_per_video_cents: after "Per-post compensation:", pattern "$NN.NN per approved deliverable"
- bonus tiers: under "Bonuses (per Deliverable):", lines of "N views: $NN.NN"
- bonus view window: "Only views accrued within NN days"
- cycle_size: "A payment cycle completes when NN deliverables"
- base comp cap: "maximum of NN posts per payment cycle"
- platforms: "Required platforms:"
- campaign name, company, term start: the Key Contract Information table
- post_public_days: "not delete, hide, or restrict it for a period of NN"

From the brief, attempt only: platforms, video length and aspect ratio, approval route, disclosure requirements, hashtag tokens. Nothing else.

Never attempt, under any circumstance, even if the text seems to mention them: handles (TikTok/Instagram), account email or password, setup type, real per-stage minutes (film/edit/post), daily post quota. No document ever contains these; if you think you see one, it is a coincidence, not this campaign's value - return null.

Money is integer cents. payout_cents of $50.00 is 5000. Never a float, never a string with a currency symbol.

If a brief looks like a lossy PDF conversion - missing headings, scrambled tables, a cross-reference to a section that is not present - set brief_is_incomplete to true and say why in warnings. Do not treat a missing section as an absent rule; say the brief looks incomplete instead of asserting the rule does not exist.

Call the return_parse_result tool exactly once with your findings. Do not explain yourself outside the tool call.`

async function callModel(briefText: string | null, contractText: string | null): Promise<ParseResult> {
  const userContent = [
    contractText !== null ? `--- CONTRACT ---\n${contractText}` : '--- CONTRACT ---\n(none provided)',
    briefText !== null ? `--- BRIEF ---\n${briefText}` : '--- BRIEF ---\n(none provided)',
  ].join('\n\n')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      // The response is a fixed JSON shape and never needs more.
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      tools: [
        {
          name: 'return_parse_result',
          description: 'Return the extracted campaign fields.',
          input_schema: PARSE_RESULT_SCHEMA,
        },
      ],
      tool_choice: { type: 'tool', name: 'return_parse_result' },
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Model API returned ${response.status}: ${detail}`)
  }

  const body = await response.json()
  const toolUse = (body.content ?? []).find((block: { type: string }) => block.type === 'tool_use')
  if (!toolUse) {
    throw new Error('Model did not return a tool call.')
  }
  return toolUse.input as ParseResult
}

/** Drops any never-parsed field the model returned anyway, per contract. */
function dropNeverParsedFields(result: ParseResult): ParseResult {
  const fields = { ...result.fields }
  for (const key of NEVER_PARSED_FIELDS) {
    delete fields[key]
  }
  return { ...result, fields }
}

/** The tool schema asks for strings, but a tool call is a hint, not an
 *  enforced type - a model asked for "3500" will sometimes hand back the JSON
 *  number 3500 instead. Every consumer of ParsedField.value (verifyQuotes,
 *  the review screen, applyParseResult) is written against `string | null`,
 *  so this coerces before anything downstream sees it, rather than trusting
 *  the schema to have been followed. */
function coerceFieldValuesToStrings(result: ParseResult): ParseResult {
  const fields: ParseResult['fields'] = {}
  for (const [key, field] of Object.entries(result.fields)) {
    fields[key] = {
      ...field,
      value: field.value === null || field.value === undefined ? null : String(field.value),
    }
  }
  return { ...result, fields }
}

/** Money is integer cents (docs/EDGE_FUNCTION.md): "reject the model's output
 *  rather than rounding it yourself if it comes back as dollars." So unlike
 *  ParsedField.value above, a bonus tier with a non-integer payout or
 *  threshold is dropped, not coerced - coercing a float could silently accept
 *  a dollar amount mistaken for cents. */
function dropMalformedBonusTiers(result: ParseResult): ParseResult {
  const warnings = [...result.warnings]
  const bonus_tiers = result.bonus_tiers.filter((tier) => {
    const valid =
      Number.isInteger(tier.threshold_views) &&
      Number.isInteger(tier.payout_cents) &&
      (tier.view_window_days === null || Number.isInteger(tier.view_window_days))
    if (!valid) {
      warnings.push(
        `A bonus tier ("${tier.label}") was dropped: its numbers were not the integer cents/views the schema requires.`,
      )
    }
    return valid
  })
  return { ...result, bonus_tiers, warnings }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'POST only.' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return jsonResponse({ error: 'Missing Authorization header.' }, 401)
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) {
    return jsonResponse({ error: 'Invalid or expired session.' }, 401)
  }

  let briefText: string | null
  let contractText: string | null
  try {
    const body = await req.json()
    briefText = body.briefText ?? null
    contractText = body.contractText ?? null
  } catch {
    return jsonResponse({ error: 'Body must be JSON: { briefText, contractText }.' }, 400)
  }

  if (briefText === null && contractText === null) {
    return jsonResponse({ error: 'At least one of briefText or contractText is required.' }, 400)
  }

  let parsed: ParseResult
  try {
    parsed = await callModel(briefText, contractText)
  } catch (err) {
    return jsonResponse({ error: `Parse failed: ${(err as Error).message}` }, 502)
  }

  parsed = dropMalformedBonusTiers(coerceFieldValuesToStrings(dropNeverParsedFields(parsed)))
  const { result } = verifyQuotes(parsed, { briefText, contractText })

  return jsonResponse(result)
})
