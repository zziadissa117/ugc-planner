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

As of 2026-09-06 the live project (`uykuoibqdxmpbbrsmyad`) has run 0001 and 0003
through 0006, plus 0008.

**0007 is deliberately unapplied.** It drops `campaigns.daily_post_quota`, which
the shipped UI still reads. It goes last, once the accounts editor has replaced
every reader and has been right in use for a while - a column that has stopped
being read can be brought back, and a dropped one cannot.

## Writing a new one

Make it re-runnable. The files up to 0006 pair `create table if not exists` with
a bare `create policy`, so a second run creates nothing and then aborts on
`policy ... already exists`, having half succeeded. Put
`drop policy if exists <name> on <table>;` before each `create policy`.
