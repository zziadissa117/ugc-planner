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

### 1. Provision the project and set two environment variables

Create the Supabase project, then set in `.env`:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

The publishable (anon) key is the only one that may appear here. The service
role key and the model API key must never be in anything the browser loads -
that is the whole reason the parser runs server-side.

Until these are set, `getSupabaseClient()` returns null, `isReady()` is false,
and the drain does nothing. That is a normal state: the app is local-first and
works completely without a server.

### 2. Apply `docs/schema.sql` as the first migration

It applies cleanly to stock Postgres. The one thing PGlite could not check is
Supabase's own machinery: `auth.users`, `auth.uid()` and the `authenticated`
role are stubbed in the test. The RLS policies are created there but never
exercised, because there is no authenticated role to exercise them as.

**Verify after applying:** sign in as one account, create a row, sign in as
another, and confirm the second cannot see it. Nothing so far proves RLS
actually isolates users.

### 3. Deploy the parser Edge Function

`EdgeFunctionParser` is a stub. The contract it has to hold up is written down
in `src/parser/edgeFunction.ts`: request structured JSON against a strict
schema, instruct the model to return null for anything absent and never to
infer, require a `source_quote` on every field, and verify each quote against
the uploaded text server-side before returning.

`verifyQuotes` in `src/parser/verify.ts` is that check, already written and
tested. The Edge Function should run the same logic, not a second version of
it.

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
