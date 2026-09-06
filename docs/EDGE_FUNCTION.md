# The parser Edge Function - contract for deployment

Blocker #5 from `docs/SYNC.md`. This is what the function has to do, why each
part is there, and what it must refuse to do.

The function name the client expects is **`parse-campaign`**.

## Why it is server-side at all

The model API key must never reach the browser. That is the entire reason this
is a function rather than a client call, and it is the one thing that cannot be
compromised for convenience.

## Reuse `verifyQuotes` - do not reimplement it

`src/parser/verify.ts` already implements the quote check, and it is tested.
The function must run **that logic**, not a second version of it. Two
implementations of "is this quote real?" will drift, and the day they disagree
is the day a fabricated rate gets written as `documented`.

Practically: copy `verify.ts` into the function's source (it imports only its
own types), or vendor it via a shared path. Do not rewrite it in the handler,
and do not simplify its whitespace normalisation - that normalisation is
load-bearing and is explained in the file.

## Request

```
POST /functions/v1/parse-campaign
Authorization: Bearer <the caller's Supabase access token>
Content-Type: application/json

{ "briefText": string | null, "contractText": string | null }
```

Require a valid session and reject anonymous calls. This spends money per
request; it should not be an open endpoint.

## Response

Exactly `ParseResult` from `src/parser/types.ts`:

```ts
{
  campaign: { name: string, company: string | null, approval_mode: ApprovalMode | null },
  fields: Record<string, { value: string | null, source_quote: string | null, from?: 'brief' | 'contract' }>,
  bonus_tiers: { label, threshold_views, payout_cents, view_window_days }[],
  rules: string[],
  brief_is_incomplete: boolean,
  warnings: string[]
}
```

`approval_mode` is one of `none | video | script_and_video | brand_scripted`.

**Money is integer cents.** `payout_cents` is `5000` for $50.00. Never a float,
never a string with a currency symbol. Reject the model's output rather than
rounding it yourself if it comes back as dollars.

## The model prompt

Three instructions carry the weight. State them plainly and repeat them:

1. **Return `null` for anything the documents do not state.** Absence is a
   valid, expected, common answer. Never infer, never complete a pattern, never
   fill a gap from general knowledge of how such contracts usually read.
2. **Every field must carry `source_quote`: the exact substring it was read
   from,** copied verbatim from the document, not paraphrased or tidied.
3. **Never guess a value in order to have something to return.** A blank is
   correct; a plausible number is the worst possible answer, because nothing
   downstream can tell it apart from a real one.

Ask for structured JSON against a strict schema, so a malformed shape fails
loudly instead of half-parsing.

### Parse with high confidence - contracts are templated

SideShift contracts repeat the same headings. These anchors are from SPEC
section 7:

| Field key | Anchor in the contract |
|---|---|
| `pay_per_video_cents` | `Per-post compensation:` then `$NN.NN per approved deliverable` |
| bonus tiers | under `Bonuses (per Deliverable):`, lines of `N views: $NN.NN` |
| bonus view window | `Only views accrued within NN days` |
| `cycle_size` | `A payment cycle completes when NN deliverables` |
| base comp cap | `maximum of NN posts per payment cycle` |
| `platforms` | `Required platforms:` |
| campaign name, company, term start | the Key Contract Information table |
| `post_public_days` | `not delete, hide, or restrict it for a period of NN` |

### Attempt only these from the brief

Briefs have no fixed format. Try platforms, video length and aspect ratio,
approval route, disclosure requirements, and hashtag tokens. Nothing else.

### Never attempt these at all

Handles, the account email or password, editing style, setup type, real
per-stage minutes, and the daily quota. **No document ever contains them.** They are in
`NEVER_PARSED_FIELDS` in `src/parser/types.ts`, and the review screen already
says in one plain line
that they were not attempted, so that a blank reads as the app working rather
than as a bug. If the model returns them, drop them.

## After the model responds - the part that is not optional

1. Run `verifyQuotes(result, { briefText, contractText })`.
2. Any field whose quote cannot be found in the document it claims to come from
   is **blanked, not dropped** - value `null`, quote `null`. The key stays
   visible so an invented value shows up as an obvious gap on the review screen
   instead of silently vanishing as though never attempted.
3. Return the blanked keys in `warnings` so the review screen can say what was
   discarded and why.

This is what makes fabrication a mechanical failure rather than something we
trust the model not to do.

## Damaged briefs

These markdown files are PDF conversions: lost headings, scrambled tables, OCR
garbage. Do not crash, and **do not treat a missing section as an absent rule.**

`inspectBrief` in `src/parser/damage.ts` already detects non-sequential section
numbers and cross-references pointing at sections that are not present. The
client runs it on the brief directly rather than taking the parse's word for
it, so the function's own `brief_is_incomplete` is advisory - the client ORs
the two. Set it when the model reports damage, and let the client's own
inspection stand alongside.

## Nothing here may write to the database

The function parses and returns. It creates no campaign, no fields, no rows.

Writing is `applyParseResult`'s job, on the client, after the user has confirmed
each field by tapping it, inside `runTransaction`. That ordering is what keeps
`documented` meaning "a human looked at this and a quote backs it" - and the
schema enforces it too: `documented_needs_proof` requires both a `confirmed_at`
and a `source_quote`.

## Once deployed

Flip `EdgeFunctionParser.isAvailable()` to return true when the client is
configured, and give `parse()` a body that posts the request above. Nothing
else in the app changes: the drop box already picks the server parser when it
is available and falls back to the paste-JSON path when it is not, and both
paths already run through the same verification.

---

# generate-hooks

The second function, and the same shape as the first: the model API key is a
server secret, the caller must have a valid session, and the function writes
nothing to the database. It generates and returns; the client decides what to
keep.

## Why the client sends the campaign material

`parse-campaign` is given documents because only the client has them. This one
could have read the campaign from Postgres instead - and deliberately does not.
The app is local-first and the campaign already lives on the device, so having
the function query for it would make the function a second place that knows how
a campaign is shaped, free to drift from `src/data`. That is the same reasoning
that kept `SupabaseAdapter` out of the design (`docs/SYNC.md`).

## What it is allowed to work from

Only the campaign's own stored material: `product_facts`, `audience`, `tone`,
`structure`, the `campaign_rules` never-do list, and the angles the campaign's
own brief documents. Angles with `is_verified = false` are **not** sent - those
come from the user's skill file, and SPEC section 11 says the two sources must
never be merged into one list.

A section with nothing behind it is sent as `(not saved yet)` rather than
omitted or filled in, the same rule `src/chatgpt.ts` follows. The prompt says
that thin material means fewer and simpler hooks, not invented ones.

## The rules the prompt holds

1. Every claim must be supported by the PRODUCT section. No invented statistic,
   price, percentage, guarantee or feature.
2. The never-do list is absolute.
3. One angle per hook.
4. Angle ids are chosen from the list given, never invented.

Rule 4 is also enforced after the fact: `dropUnknownAngles` clears any
`angle_id` the campaign does not have. A tool schema is a hint, not an enforced
type, and an id pointing at nothing would fail the foreign key on insert.
Reassigning it to some other angle would be worse - a hook filed under a
storyline nobody chose - so the id is dropped and the text is kept.

## The shared module, and why it is guarded

`src/hooks/hookPrompt.ts` is the source of record; the vendored copy is
`supabase/functions/_shared/hookPrompt.ts`. It holds both the prompt assembly
and the FEAR/GREED rotation, because the console labels the next batch using
the client copy and the prompt asks for it using the vendored one. If those
drifted, the app would tell him one thing and request another, and nothing
would fail. `src/hooks/hookPromptDriftGuard.test.ts` runs both against the same
inputs.

## Deploying it

Same as `parse-campaign`, with one layout note: the deploy tool nests the
entrypoint under `source/`, so the files must be named `source/index.ts`,
`source/deno.json` and `_shared/hookPrompt.ts` for `../_shared/...` to resolve.
Naming the entrypoint `index.ts` puts the shared file under `source/` too and
the bundle fails with "Module not found".

Set `VITE_GENERATE_HOOKS_DEPLOYED=true` only after a smoke test. Until then the
console does not offer to write hooks and he writes them himself on the brief
page - a working path, not a broken button.

Env: `ANTHROPIC_API_KEY` (project secret, shared with parse-campaign) and
`GENERATE_HOOKS_MODEL` (optional, defaults to `claude-haiku-4-5-20251001`).
