# Sync - what is built, and what is blocked

Phase 9 built everything that does not need a Supabase project. This file is
the list of what does, so unblocking is a checklist rather than an
investigation.

## What works today, verified

- **The outbox.** Every write already enqueues. `listPendingWrites`,
  `markWriteSynced`, `markWriteFailed` and `applyRemoteRow` are on
  `DataAdapter` and implemented in `LocalAdapter`.
- **The drain** (`src/sync/engine.ts`). Sends oldest-first, stops the batch at
  the first outage instead of burning every entry's attempt count on the same
  failure, keeps permanently-rejected writes in the queue with the reason
  attached rather than discarding them, and stops retrying a stuck write while
  leaving it visible.
- **Conflict rules** (`src/sync/conflict.ts`). Last-write-wins on `updated_at`,
  with two exceptions: history is never rewritten, and a locked-in
  `rate_snapshot_cents` survives the merge whichever side wins the row.
- **`docs/schema.sql` itself.** It is executed against a real Postgres in
  `src/data/schema.sql.test.ts` using PGlite - no Docker needed. Every enum,
  every constraint and the RLS setup are verified, including that
  `phase_events` has only INSERT and SELECT policies.

All of the above is covered by tests that need no network.

## What is verified against the real project

`src/sync/supabaseTarget.ts` and `src/sync/auth.ts` are no longer a first
draft that only compiles - `src/sync/rls.live.test.ts` and
`src/sync/claim.live.test.ts` exercise them over real HTTP against project
`uykuoibqdxmpbbrsmyad`: two real accounts, RLS isolation and the
`phase_events` INSERT/SELECT-only policies proven through PostgREST, and a
full local-store-to-claimed-account-to-drained-outbox run with zero
rejections. Run with `npm run test:live` (needs Confirm Email off - see
below).

## Done since: idempotent history, and claiming rows

Both of these were blockers and are now built and tested. They needed a
decision and a real store, not a provisioned project.

### phase_events are now idempotent to push

`phase_events.client_id` is minted on the client before the row lands, with
`unique (user_id, client_id)` behind it. A retry of a push that already
landed breaks that constraint, and `SupabaseSyncTarget` reads the `23505` as
"already applied" - so the event exists on the server exactly once.

Shipped as `docs/migrations/0002_phase_events_client_id.sql` as well as in
`schema.sql`, because a project provisioned from the current schema already
has the column and must skip the migration. Both paths are covered: PGlite
applies 0002 to a database built from a schema with the column stripped out,
and a guard test asserts that stripping really happened, so the migration
test cannot pass for the wrong reason.

### Local rows are claimed on first sign-in

`claimLocalRows` (`src/sync/claim.ts`) reassigns every row from the
localStorage id to the account id, in one transaction, and rewrites the
outbox entries queued under the old id along with them. It refuses a
non-uuid account id, and it is a no-op the second time, so it cannot split
the data between two owners.

Tested two ways. `claim.test.ts` uses a real LocalAdapter with a fake that
only answers "who is signed in?" - the same approach as the schema tests,
standing in for the one unavailable piece rather than mocking away the
substance - and drains through a target that refuses anything not owned by
the signed-in account, asserting nothing is refused. `claim.live.test.ts`
does the same thing against a real account and the real `SupabaseSyncTarget`:
signs up for real, claims, drains, and then re-reads the rows over HTTP to
confirm they landed under the account rather than trusting the local outbox's
own report. Both pass. That is the failure worth catching: a refused push
looks from the outside exactly like a successful one with nothing to send.

## The blockers, in the order they need clearing

### 1. Provision the project - DONE

Project `ugc-planner`, ref `uykuoibqdxmpbbrsmyad`, ca-central-1. `.env` holds
the URL and the publishable key and is git-ignored; `.env.example` is the
committed template. The publishable key is the client-side one and is
independently rotatable - not the legacy anon JWT, and never the service role
key.

### 2. Apply the schema and verify RLS - DONE

`schema.sql` applied, matching commit f8810ee. Migration 0002 correctly
skipped: `phase_events` carries exactly one unique constraint,
`phase_events_user_id_client_id_key`, so there is no redundant second index.
Twelve tables, all RLS-enabled, thirteen policies. `get_advisors` clean.

RLS is verified behaviourally by `docs/rls-check.sql`, which runs as the
`authenticated` role with real JWT claims - the same mechanism PostgREST sets
per request. It proves account isolation in both directions, and that
`phase_events` refuses UPDATE and DELETE even for the account that owns the
row. It is self-validating: A inserts and asserts it can see its own row
before B looks, so B’s zero counts cannot be an empty table passing for
isolation. Re-run it after any policy change.

Now proven both ways: `docs/rls-check.sql` at the policy level, and
`src/sync/rls.live.test.ts` over HTTP through two real signed-in supabase-js
sessions - B never sees A's rows, and UPDATE/DELETE on `phase_events` fails
through PostgREST for either account. `claimLocalRows` is proven the same way
in `src/sync/claim.live.test.ts` - see above.

Confirm Email had to be turned off (Authentication → Providers → Email) for
`signUp` to return a session rather than requiring a confirmation email the
built-in SMTP is rate-limited to about one an hour. Done. Every `test:live`
run mints one or two throwaway `<prefix>-<timestamp>@ugcplanner.app`
accounts that the tests can't delete themselves - no admin key available to
them - though each cleans up every row it owns before exiting. Several such
accounts (owning nothing) are sitting in `auth.users` from the runs during
this work; delete them from Authentication → Users whenever convenient, same
as the original stray probe account.

### 3. Deploy the parser Edge Function - DONE

`supabase/functions/parse-campaign` is written, deployed, and smoke-tested
against a real request (function id `d5c80cae-0390-43c2-a9b7-e390ae8d2f05`,
version 3, status ACTIVE - versions 1-2 were replaced; see the note below).
It holds up the contract in `docs/EDGE_FUNCTION.md`: requires a valid
session, calls the Anthropic Messages API (`claude-haiku-4-5-20251001`,
forced tool call against a strict JSON schema, capped at 4000 output tokens)
with the three prompt rules stated plainly, and runs `verifyQuotes` -
vendored into `supabase/functions/_shared/verify.ts`, guarded by
`src/parser/edgeFunctionVerify.driftGuard.test.ts` so the copy cannot
silently disagree with `src/parser/verify.ts` - before returning anything.
`NEVER_PARSED_FIELDS` are stripped from the model's response, and two things
the tool schema cannot actually enforce are handled explicitly:
`ParsedField.value` is coerced to a string (a live call showed the model
handing back a bare JSON number for a dollar amount, which every downstream
consumer expects as `string | null`), and a bonus tier whose numbers are not
integers is dropped with a warning rather than coerced, per
`docs/EDGE_FUNCTION.md`'s "reject rather than round" instruction.

`ANTHROPIC_API_KEY` is set as a project secret (confirmed working - a real
signed-in call returns a real parsed result). `SUPABASE_URL` and
`SUPABASE_ANON_KEY` needed no action; Supabase injects both into every
function automatically. `src/parser/edgeFunction.live.test.ts` covers the
whole round trip - auth, model, quote verification - against a real templated
contract, plus that a call missing a bearer token is refused.

`src/parser/edgeFunction.ts` gates `EdgeFunctionParser.isAvailable()` on
`VITE_PARSE_CAMPAIGN_DEPLOYED=true` in `.env`, deliberately separate from "the
client can reach a Supabase project" - flip it now that the function is
verified working.

**A deploy anomaly worth knowing about:** between the first `deploy_edge_function`
call (version 1, working but with the value-type bug above) and a second call
that only changed `index.ts`, `get_edge_function` showed a version 2 with
code that had never been submitted - a different auth check, a different
prompting approach, a `deno.json` this session never wrote. The second deploy
call had errored before completing, so that content did not come from this
session's tool calls. The cause was not root-caused; what's confirmed is that
redeploying explicitly (with `deno.json` included and `import_map_path` set)
produced version 3 matching the submitted files exactly, verified by reading
it back before testing further. If a future deploy ever produces a diff from
what was submitted, read it back with `get_edge_function` before trusting it.

### 4. A full `SupabaseAdapter` - decided: not wanted

`CLAUDE.md` says `SupabaseAdapter` gets written against the same `DataAdapter`
interface. Sync did not need it, and building it was deliberately not done.

The reason: the outbox pushes **rows**, and `DataAdapter` is an interface of
**intents** - `advanceVideoPhase`, `markVideoPosted`, `confirmCampaignField`.
Implementing those remotely would put the phase chain, the rate snapshot rule
and the provenance rules on the server as a second copy, free to drift from the
one in `src/data`. `SyncTarget` is row-level on purpose.

Decided: not building it. `SyncTarget` stays row-level, and online-only mode
is out of scope. If that changes, the interface is already there to
implement against.
