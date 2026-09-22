// The hook generator Edge Function. Contract: docs/EDGE_FUNCTION.md.
//
// Calls the model server-side (the key must never reach the browser),
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
import {
  HOOK_SYSTEM_PROMPT,
  RETURN_HOOKS_SCHEMA,
  buildHookRequest,
  dropUnknownAngles,
  type GenerateHooksResult,
  type HookContext,
} from '../_shared/hookPrompt.ts'
import { ModelError, callForJson, jsonResponse, refuseUnlessSignedIn } from '../_shared/claude.ts'

// Opus. Hook writing is the one genuinely creative call the app makes, and
// the failure it keeps having is sameness - Haiku returned nine rewordings of
// the brief's thesis, Sonnet handed back lines from his own hook bank. At
// medium effort it thinks enough to hold every hook against his material and
// against the others, and answers in well under a minute.
const MODEL = Deno.env.get('GENERATE_HOOKS_MODEL') ?? 'claude-opus-5'

/** Hooks and their beats are short and there are never many; the rest is
 *  room to think. */
const MAX_TOKENS = 12000

/** More than this and he is not working down a list, he is reading a wall. */
const MAX_HOOKS = 20

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
  // His own hooks and ideas. Absent is normal - an older client does not send
  // them at all - so this defaults to empty rather than refusing the request.
  const referenceMaterial = Array.isArray(raw.referenceMaterial)
    ? (raw.referenceMaterial.filter((entry) => typeof entry === 'string') as string[])
    : []

  return {
    campaignName: raw.campaignName,
    company: typeof raw.company === 'string' ? raw.company : null,
    productFacts: typeof raw.productFacts === 'string' ? raw.productFacts : null,
    audience: typeof raw.audience === 'string' ? raw.audience : null,
    tone: typeof raw.tone === 'string' ? raw.tone : null,
    structure: typeof raw.structure === 'string' ? raw.structure : null,
    // The whole pasted brief. Absent is normal - an older client does not
    // send it - so this defaults to null rather than refusing the request.
    generationBrief: typeof raw.generationBrief === 'string' ? raw.generationBrief : null,
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
    referenceMaterial,
    lastFamily: typeof raw.lastFamily === 'string' ? raw.lastFamily : null,
    // Capped rather than refused: asking for 50 is a slip, not an error worth
    // failing his session over.
    count: Math.min(count, MAX_HOOKS),
  }
}

Deno.serve(async (req: Request) => {
  const refused = await refuseUnlessSignedIn(req)
  if (refused) return refused

  let parsed: unknown
  try {
    parsed = await req.json()
  } catch {
    return jsonResponse({ error: 'Body must be JSON.' }, 400)
  }

  const context = readContext(parsed)
  if (typeof context === 'string') return jsonResponse({ error: context }, 400)

  let answer: { data: GenerateHooksResult; model: string }
  try {
    answer = await callForJson<GenerateHooksResult>({
      model: MODEL,
      system: HOOK_SYSTEM_PROMPT,
      user: buildHookRequest(context),
      schema: RETURN_HOOKS_SCHEMA,
      effort: 'medium',
      maxTokens: MAX_TOKENS,
    })
  } catch (err) {
    const message = err instanceof ModelError ? err.message : (err as Error).message
    return jsonResponse({ error: `Hook generation failed: ${message}` }, 502)
  }

  // A model told to pick an angle id from a list will occasionally return one
  // that is not in it. Dropped rather than reassigned: a hook filed under a
  // storyline nobody chose is worse than one with no angle.
  const result = dropUnknownAngles(answer.data, context.angles)
  return jsonResponse({ ...result, model: answer.model })
})
