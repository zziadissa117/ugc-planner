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

As of 2026-09-07 the live project (`uykuoibqdxmpbbrsmyad`) has run 0001, 0003
through 0006, 0008 and 0009.

**0007 was deleted, not deferred.** It dropped `campaigns.daily_post_quota` on
the theory that `campaign_accounts.posts_per_day` had replaced it. That turned
out to be backwards: a campaign posting one video to three platforms owes one
deliverable, not three, and deriving demand from the account list let the
number of platforms multiply both the day's obligation and the day's earnings.
`daily_post_quota` is now the single source of both and is never dropped. It
was never applied anywhere, so deleting the file left nothing behind.

## Writing a new one

Make it re-runnable. The files up to 0006 pair `create table if not exists` with
a bare `create policy`, so a second run creates nothing and then aborts on
`policy ... already exists`, having half succeeded. Put
`drop policy if exists <name> on <table>;` before each `create policy`.
