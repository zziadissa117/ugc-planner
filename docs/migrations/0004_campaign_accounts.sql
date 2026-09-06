-- 0004 - posting accounts and account-specific warm-up.
--
-- Apply to a database that has already run schema.sql (migration 0001) and
-- 0002/0003 without these changes. A project provisioned from the current
-- schema.sql already has them and must skip this file.

create type account_status as enum ('new', 'warming', 'ready');

create table campaign_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  platform text not null,
  handle text,
  posts_per_day integer not null default 0 check (posts_per_day >= 0),
  status account_status not null default 'new',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, platform)
);
create index on campaign_accounts (campaign_id);
create index on campaign_accounts (user_id, status);
alter table campaign_accounts enable row level security;
create policy campaign_accounts_owner on campaign_accounts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table warmup_events add column account_id uuid default null references campaign_accounts(id) on delete cascade;
create index on warmup_events (account_id, occurred_at);
