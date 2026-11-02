-- 0022: income he makes outside UGC campaigns, entered by hand.
--
-- Detailing clients and media maxing work, added on the day - one row per
-- amount, in USD or CAD as he was paid - and counted into the Post screen's
-- "Made today". The screen that writes it is shown to the owner only; the
-- table itself is per user, like every other, so nobody reads another's.
--
-- Re-runnable: types and table are guarded, the policy is dropped first.

do $$ begin
  create type public.side_income_source as enum ('detailing', 'media_maxing');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.currency_code as enum ('USD', 'CAD');
exception when duplicate_object then null; end $$;

create table if not exists public.side_income (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  source       public.side_income_source not null,
  amount_cents integer not null check (amount_cents > 0),
  currency     public.currency_code not null,
  earned_on    date not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists side_income_user_id_earned_on_idx on public.side_income (user_id, earned_on);

alter table public.side_income enable row level security;
drop policy if exists side_income_owner on public.side_income;
create policy side_income_owner on public.side_income for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
