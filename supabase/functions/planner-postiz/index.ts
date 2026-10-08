// Which Postiz channels a campaign holds, for freeing them when it ends.
//
//   POST { action: 'channels', cutterCampaignId } -> { enabled, profiles }
//
// His Postiz plan counts connected channels (30), and a finished campaign
// keeps its accounts connected until he disables them. Postiz's public API
// cannot disable one - its only account call deletes it for good, scheduled
// posts and all - so the planner shows the accounts and he switches them off
// in Postiz, then checks again. Design and the pattern for later "brain"
// functions: docs/PLANNER_API.md.
//
// Owner only (_shared/owner.ts). Anyone else gets `enabled: false` and
// nothing, the same way cutter-posted answers. The Postiz key never comes
// here: the cutter's own `postiz` function holds it, reads the account list
// and sends back only the report (silence-cutter, postiz/channels.ts). This
// function proves itself to that one with the project's service key, which
// both already have.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { jsonResponse, requireUser } from '../_shared/claude.ts'
import { isOwner } from '../_shared/owner.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req: Request) => {
  const auth = await requireUser(req)
  if (auth instanceof Response) return auth
  if (!isOwner(auth.userId)) return jsonResponse({ enabled: false, profiles: [] })

  let body: { action?: unknown; cutterCampaignId?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Body must be JSON.' }, 400)
  }
  if (body.action !== 'channels') return jsonResponse({ error: 'Unknown action.' }, 400)
  const cutterCampaignId = typeof body.cutterCampaignId === 'string' ? body.cutterCampaignId.trim() : ''
  if (cutterCampaignId === '') return jsonResponse({ error: 'cutterCampaignId is required.' }, 400)

  let response: Response
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/postiz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-planner-bridge': SERVICE_KEY },
      body: JSON.stringify({ action: 'channels', cutterCampaignId }),
      signal: AbortSignal.timeout(60_000),
    })
  } catch (error) {
    return jsonResponse({ error: `The cutter could not be reached (${(error as Error).message}).` }, 502)
  }

  const answer = (await response.json().catch(() => null)) as { profiles?: unknown; error?: unknown } | null
  if (!response.ok || !answer || !Array.isArray(answer.profiles)) {
    // A cutter deployed before the channels action takes it for a phone
    // request with no login, and answers signed-out.
    if (answer?.error === 'signed-out') {
      return jsonResponse(
        { error: 'The cutter is not updated for this yet - run ./deploy-server.sh in silence-cutter.' },
        502,
      )
    }
    const said = typeof answer?.error === 'string' ? answer.error : `status ${response.status}`
    return jsonResponse({ error: `The cutter could not list the channels (${said}).` }, 502)
  }
  return jsonResponse({ enabled: true, profiles: answer.profiles })
})
