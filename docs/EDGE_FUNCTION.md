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

Handles, setup type, real per-stage minutes, and the daily quota. **No document
ever contains them.** They are in `NEVER_PARSED_FIELDS` in
`src/parser/types.ts`, and the review screen already says in one plain line
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
