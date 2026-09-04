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

### 3. Decide how `phase_events` rows are de-duplicated - needs a schema change

`phase_events.id` is a `bigserial`. Locally that is a client-side sequence; on
the server it is a different sequence. So the local id is meaningless remotely,
and `SupabaseSyncTarget.push` strips it and lets the server assign one.

That makes pushing an event **not idempotent**. If a push succeeds but the
response is lost, the retry inserts the event a second time. Duplicated
`phase_events` corrupt MEASURED timings, which are derived from that log.

The fix is a client-generated key, and it is a change to the authoritative
schema, so it is not being made unilaterally:

```sql
alter table phase_events
  add column client_id uuid not null default gen_random_uuid(),
  add constraint phase_events_client_id_unique unique (user_id, client_id);
```

The insert then carries `client_id`, and a retry hits the unique constraint and
is treated as already-applied. **This needs your approval before phase 9 can
finish.**

### 4. Claim local rows on first sign-in

Local rows are minted with a local user id from `localStorage`, because there
is no `auth.uid()` before sign-in. On the first sign-in, every row's `user_id`
has to be rewritten to the real account id, exactly once, or RLS will refuse
all of them and the first sync will silently push nothing.

Not implemented. It needs a real account to test against, and getting it wrong
means orphaning the only copy of his data. It should run inside
`runTransaction` and should refuse to run twice.

### 5. Deploy the parser Edge Function

`EdgeFunctionParser` is a stub. The contract it has to hold up is written down
in `src/parser/edgeFunction.ts`: request structured JSON against a strict
schema, instruct the model to return null for anything absent and never to
infer, require a `source_quote` on every field, and verify each quote against
the uploaded text server-side before returning.

`verifyQuotes` in `src/parser/verify.ts` is that check, already written and
tested. The Edge Function should run the same logic, not a second version of
it.

### 6. Decide whether a full `SupabaseAdapter` is wanted

`CLAUDE.md` says `SupabaseAdapter` gets written against the same `DataAdapter`
interface. Sync did not need it, and building it was deliberately not done.

The reason: the outbox pushes **rows**, and `DataAdapter` is an interface of
**intents** - `advanceVideoPhase`, `markVideoPosted`, `confirmCampaignField`.
Implementing those remotely would put the phase chain, the rate snapshot rule
and the provenance rules on the server as a second copy, free to drift from the
one in `src/data`. `SyncTarget` is row-level on purpose.

A full `SupabaseAdapter` is still worth having if you ever want an online-only
mode - a browser with no local data reading straight from Postgres. It is not
needed for sync. **Tell me which you want.**
