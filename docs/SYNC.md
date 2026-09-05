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

## What is written but unverified

`src/sync/supabaseTarget.ts` and `src/sync/auth.ts` are written against the
supabase-js API and have never reached a server. Treat them as a first draft
that compiles, not as working code.

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

Tested against a real LocalAdapter with a fake that only answers "who is
signed in?" - the same approach as the schema tests, standing in for the one
unavailable piece rather than mocking away the substance. The end-to-end case
drains the outbox through a target that refuses anything not owned by the
signed-in account, the way RLS does, and asserts nothing is refused. That is
the failure worth catching: a refused push looks from the outside exactly
like a successful one with nothing to send.

Still unverified against real RLS, which is blocker 2.

## The blockers, in the order they need clearing

### 1. Provision the project - DONE

Project `ugc-planner`, ref `uykuoibqdxmpbbrsmyad`, ca-central-1. `.env` holds
the URL and the publishable key and is git-ignored; `.env.example` is the
committed template. The publishable key is the client-side one and is
independently rotatable - not the legacy anon JWT, and never the service role
key.

### 2. Apply the schema and verify RLS - DONE, with one part outstanding

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

**Outstanding:** the same assertions over HTTP, through two signed-in
supabase-js sessions. That covers the client wiring rather than the policies,
and it is blocked - see below.

## Blocked on one project setting

Email confirmation is ON, so `signUp` returns a user but no session, and the
built-in SMTP is rate-limited to roughly one message an hour. Writing
`auth.users` rows directly is refused by this environment, which is the right
call and was not worked around.

To unblock, either:

- turn **Authentication → Providers → Email → Confirm email** off (normal for
  a dev project, and the quickest path), or
- create two confirmed accounts by hand and share the credentials.

Then two things run immediately, both already written:

1. The two-account client test, asserting B never sees A’s rows over HTTP and
   that UPDATE/DELETE on `phase_events` fails through PostgREST.
2. `claimLocalRows` against a real first sign-in, confirming that local rows
   minted under the localStorage id are all reassigned and that the first
   drain pushes them without a single RLS rejection.

One stray account from probing is left in `auth.users`
(`ugc-rls-1788622981837-hdca4j@ugcplanner.app`, unconfirmed, owns no rows) -
delete it whenever convenient.
### 3. Deploy the parser Edge Function - deployed, one secret outstanding

`supabase/functions/parse-campaign` is written and deployed (function id
`d5c80cae-0390-43c2-a9b7-e390ae8d2f05`, version 1, status ACTIVE). It holds up
the contract in `docs/EDGE_FUNCTION.md`: requires a valid session, calls the
Anthropic Messages API (`claude-haiku-4-5-20251001`, forced tool call against a
strict JSON schema) with the three prompt rules stated plainly, and runs
`verifyQuotes` - vendored into `supabase/functions/_shared/verify.ts`, guarded
by `src/parser/edgeFunctionVerify.driftGuard.test.ts` so the copy cannot
silently disagree with `src/parser/verify.ts` - before returning anything.
`NEVER_PARSED_FIELDS` are stripped from the model's response before the quote
check runs.

**Outstanding:** the function reads `ANTHROPIC_API_KEY` from its environment
and there is no MCP tool that can set a Supabase project secret, nor should a
model API key pass through an agent's tool calls or shell history. Set it by
hand:

```
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref uykuoibqdxmpbbrsmyad
```

or Dashboard → Edge Functions → parse-campaign → Secrets. `SUPABASE_URL` and
`SUPABASE_ANON_KEY` need no action - Supabase injects both into every
function automatically.

Once the secret is set, smoke-test with a real signed-in session before
flipping the client over - `src/parser/edgeFunction.ts` gates
`EdgeFunctionParser.isAvailable()` on `VITE_PARSE_CAMPAIGN_DEPLOYED=true` in
`.env`, deliberately separate from "the client can reach a Supabase project",
so a live-but-untested function cannot silently start serving real drop-box
parses.

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
