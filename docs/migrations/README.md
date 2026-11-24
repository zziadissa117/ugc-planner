# Migrations

`docs/schema.sql` is the authoritative shape and is **migration 0001**. Apply it
first to an empty project.

Files here are deltas against a database that has already run everything before
them. They exist because the schema is expected to change after a project is
provisioned, and at that point editing `schema.sql` alone stops being enough.

`schema.sql` always reflects the full current shape, so a fresh project needs
`schema.sql` and nothing else. An existing one needs the numbered files it has
not run yet.

## What the live project has run

Do not take this list on trust - it goes stale the moment someone applies one
by hand. Supabase records every migration applied through its own tooling, so
ask the database instead:

```sql
select version, name from supabase_migrations.schema_migrations order by version;
```

As of 2026-09-17 the live project (`uykuoibqdxmpbbrsmyad`) has run 0001, 0003
through 0006, 0008, 0009 and 0010. 0012 was applied on 2026-09-25 through
Supabase's tooling, recorded as `bonus_only_accounts`, and 0013 the same
day as `needs_submission`. 0014 was applied on 2026-09-27 as `post_position`.

0010 is recorded there under the name `monthly_pay_override` rather than
`0010_monthly_pay_override`, because it was applied through Supabase's own
migration tooling, which names the record itself. Match it to the file by what
it does, not by the string.

**0007 was deleted, not deferred.** It dropped `campaigns.daily_post_quota` on
the theory that `campaign_accounts.posts_per_day` had replaced it. That turned
out to be backwards: a campaign posting one video to three platforms owes one
deliverable, not three, and deriving demand from the account list let the
number of platforms multiply both the day's obligation and the day's earnings.
`daily_post_quota` is now the single source of both and is never dropped. It
was never applied anywhere, so deleting the file left nothing behind.

0015 (`ai_keys`, bring-your-own AI key; applied 2026-10-02) is a **server-only** table: it is not
in `schema.sql` on purpose, because everything in `schema.sql` becomes a
synced, exported, locally mirrored table. A fresh project needs `schema.sql`
and 0015. The project is shared with the cutter app, so `list_migrations` also
shows `cutter_*` entries that have no file here.

0019 (`campaign_min_views`, the views tracker's minimum) was applied on 2026-10-19 after the owner approved it.
0023 (`weekly_plan`: quiz columns on user_settings, plan_blocks) was applied on 2026-11-24 by the owner in the SQL editor; checked through the REST API. The `quiz-finished` function and its TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID secrets were set the same day.
0022 (`side_income`) was applied on 2026-11-02 by the owner himself, pasted into the SQL editor; checked afterwards through the REST API (the table answers).
0024 (`trybe_and_ideate`: trybe_videos, ideate_notes) is written but NOT yet applied to the live project.
0025 (`coach_notes`: notes the coach writes to a student) is written but NOT yet applied to the live project.
It must be applied before a build with Dexie v14 ships: the pull reads every
mirrored table and fails the whole pass at the first one the server does not
have. coach_notes is **pull-only** - written by the `coach` Edge Function with
the service role, SELECT-only for the student under RLS - so it is in
`MIRRORED_TABLES` but also in `PULL_ONLY_TABLES` (`src/data/local/db.ts`), which
keeps it out of every path that queues writes.
0026 (`postiz_posts`: postiz_posts, postiz_state - what the planner read from each
user's own Postiz, and its hourly request count) is written but NOT yet applied.
Server-only like 0015, so not in `schema.sql`; see `docs/POSTIZ_AND_COACH.md`.

0016 (`weekly_pay_payouts_earnings`) is a DRAFT, not yet applied: weekly posting
rate, per-account pay, payout schedule, `campaign_payouts`, `earnings_events`.
`src/data/schema.sql.test.ts` runs it against the pre-0016 schema in
`docs/migrations/fixtures/` and asserts the result has the same columns as
`schema.sql`.

## Writing a new one

Make it re-runnable. The files up to 0006 pair `create table if not exists` with
a bare `create policy`, so a second run creates nothing and then aborts on
`policy ... already exists`, having half succeeded. Put
`drop policy if exists <name> on <table>;` before each `create policy`.
