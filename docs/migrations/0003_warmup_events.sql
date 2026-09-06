-- 0003 - the account warm-up log.
--
-- Apply to a database that has already run schema.sql (migration 0001) and
-- 0002 without this table. A project provisioned from the current schema.sql
-- already has it and must skip this file.
--
-- "Warmed up twice" is a count taken from this log at query time, never a
-- mutable number on the campaign row - same reasoning as phase_events, and
-- the same client_id idempotency key for the same reason: a retried push
-- must not double up a completed warm-up session.

create table if not exists warmup_events (
  id           bigserial primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  minutes      integer not null check (minutes > 0),
  occurred_at  timestamptz not null default now(),
  client_id    uuid not null default gen_random_uuid(),

  unique (user_id, client_id)
);

create index if not exists warmup_events_campaign_id_occurred_at_idx
  on warmup_events (campaign_id, occurred_at);

alter table warmup_events enable row level security;

create policy warmup_events_read on warmup_events for select to authenticated
  using (user_id = (select auth.uid()));
create policy warmup_events_append on warmup_events for insert to authenticated
  with check (user_id = (select auth.uid()));
