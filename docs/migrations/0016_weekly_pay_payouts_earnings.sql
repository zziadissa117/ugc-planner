-- 0016 - weekly posting rate, per-account pay, payout dates, earnings history.
--
-- DRAFT: not applied anywhere. Shown to the owner for approval first.
--
-- Everything here is additive: new columns with defaults, two new tables, two
-- new enums. Nothing is dropped or rewritten except the one backfill in step 1.
-- Re-runnable.

-- 1. Posts per WEEK ------------------------------------------------------------
--
-- The money side reads this (week = rate x posts_per_week; day = a seventh;
-- month = 30/7 of a week). daily_post_quota stays as what the Post grid owes on
-- a day, kept at ceil(posts_per_week / 7) by the app. Existing campaigns are
-- migrated per_day x 7, so every figure on screen is unchanged by this.

alter table public.campaigns
  add column if not exists posts_per_week integer not null default 0 check (posts_per_week >= 0);

update public.campaigns
   set posts_per_week = daily_post_quota * 7
 where posts_per_week = 0 and daily_post_quota > 0;

-- 2. A rate of its own per platform --------------------------------------------
--
-- Null = the account has no rate of its own and the campaign's applies. Any
-- account with one makes the campaign pay per platform (decided in the app).

alter table public.campaign_accounts
  add column if not exists pay_per_post_cents integer default null check (pay_per_post_cents >= 0);

-- 3. Payout schedule -----------------------------------------------------------

do $$ begin
  create type payout_schedule as enum ('none', 'one_off', 'weekly', 'biweekly', 'monthly');
exception when duplicate_object then null; end $$;

alter table public.campaigns
  add column if not exists payout_schedule payout_schedule not null default 'none',
  add column if not exists payout_date date default null;

-- Payouts that have arrived. Pending = no row for that due date.
create table if not exists public.campaign_payouts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  campaign_id    uuid not null references public.campaigns(id) on delete cascade,
  due_date       date not null,
  paid_at        timestamptz not null default now(),
  received_cents integer default null check (received_cents >= 0),
  updated_at     timestamptz not null default now(),
  unique (campaign_id, due_date)
);

create index if not exists campaign_payouts_campaign_id_idx on public.campaign_payouts (campaign_id);

alter table public.campaign_payouts enable row level security;
drop policy if exists campaign_payouts_owner on public.campaign_payouts;
create policy campaign_payouts_owner on public.campaign_payouts for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 4. Earnings history (append-only) --------------------------------------------

do $$ begin
  create type earnings_source as enum ('checkoff', 'reversal');
exception when duplicate_object then null; end $$;

create table if not exists public.earnings_events (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  campaign_id    uuid not null references public.campaigns(id) on delete cascade,
  video_id       uuid not null,
  account_id     uuid default null,
  platform       text not null,
  amount_cents   integer not null,
  source         earnings_source not null,
  earned_on      date not null,
  reverses_id    uuid default null references public.earnings_events(id),
  occurred_at    timestamptz not null default now(),

  constraint checkoff_is_not_negative check (source <> 'checkoff' or amount_cents >= 0),
  constraint reversal_is_not_positive check (source <> 'reversal' or amount_cents <= 0),
  constraint reversal_names_its_checkoff check (source <> 'reversal' or reverses_id is not null)
);

create index if not exists earnings_events_user_earned_on_idx on public.earnings_events (user_id, earned_on);
create index if not exists earnings_events_campaign_earned_on_idx on public.earnings_events (campaign_id, earned_on);
create index if not exists earnings_events_video_account_idx on public.earnings_events (video_id, account_id);

alter table public.earnings_events enable row level security;
drop policy if exists earnings_events_read on public.earnings_events;
create policy earnings_events_read on public.earnings_events for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists earnings_events_append on public.earnings_events;
create policy earnings_events_append on public.earnings_events for insert to authenticated
  with check (user_id = (select auth.uid()));
