// His dictation in, one ordered to-do list out. Contract: docs/PLANNER_API.md.
//
// Like generate-hooks: a signed-in user's own key, the model asked
// server-side, nothing written to the database. The list lives on his device
// (src/dayList.ts); this only sorts.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { callForJson, errorResponse, jsonResponse, loadUserKey, requireUser } from '../_shared/claude.ts'
import {
  MAX_DICTATION,
  SORT_DAY_SCHEMA,
  SORT_DAY_SYSTEM_PROMPT,
  buildDayRequest,
  cleanSorted,
  type SortDayResult,
} from '../_shared/dayPrompt.ts'

// Sonnet: ordering a list he said out loud is careful reading, not creative
// writing, and he is waiting on it.
const MODEL = Deno.env.get('SORT_DAY_MODEL') ?? 'claude-sonnet-5-5'
const MAX_TOKENS = 8000

Deno.serve(async (req: Request) => {
  const auth = await requireUser(req)
  if (auth instanceof Response) return auth

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return jsonResponse({ error: 'Body must be JSON.' }, 400)
  }
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (text === '') return jsonResponse({ error: 'Paste what you have to do first.' }, 400)
  if (text.length > MAX_DICTATION) return jsonResponse({ error: 'That is too long to sort in one go - paste a week at most.' }, 400)
  const today = typeof body.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : new Date().toISOString().slice(0, 10)

  try {
    const answer = await callForJson<SortDayResult>({
      apiKey: await loadUserKey(auth.userId),
      model: MODEL,
      system: SORT_DAY_SYSTEM_PROMPT,
      user: buildDayRequest(text, today),
      schema: SORT_DAY_SCHEMA,
      effort: 'medium',
      maxTokens: MAX_TOKENS,
    })
    return jsonResponse({ ...cleanSorted(answer.data), model: answer.model })
  } catch (err) {
    return errorResponse(err, 'Sorting failed: ')
  }
})
