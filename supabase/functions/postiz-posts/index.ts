// The caller's own Postiz posts, for IDEATE and Today's "Going out". Contract:
// src/sync/postizPosts.ts; design: docs/POSTIZ_AND_COACH.md.
//
//   POST { from: ISO, to: ISO } -> { connected, posts: [PostizPostView], reading, error? }
//
// Every post scheduled or already out in [from, to), newest first: its
// platform and handle, live link, preview, status ('scheduled' | 'posted' |
// 'failed'), when it goes or went out, and views - null until Postiz has
// given a number. `reading` is how many in the range still wait for one;
// `error` says in plain words why Postiz could not be read this time, with
// what was read before still in `posts`. No Postiz key saved: connected false
// and nothing else - not an error.
//
// Not owner-only: every signed-in user reads their own posts with the key
// they saved in SETUP (`ai-key`, provider 'postiz'). The user id is the
// verified session's, never the body's - it is what picks whose key is
// decrypted. The key never leaves the server.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { jsonResponse, requireUser } from '../_shared/claude.ts'
import { readPostizPosts } from '../_shared/postizPosts.ts'
import { checkRange } from '../_shared/postizRules.ts'

Deno.serve(async (req: Request) => {
  const auth = await requireUser(req)
  if (auth instanceof Response) return auth

  let body: { from?: unknown; to?: unknown }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Body must be JSON.' }, 400)
  }

  const range = checkRange(body.from, body.to)
  if (typeof range === 'string') return jsonResponse({ error: range }, 400)

  return jsonResponse(await readPostizPosts(auth.userId, range))
})
