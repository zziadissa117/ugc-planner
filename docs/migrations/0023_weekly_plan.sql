-- 0023: the onboarding quiz and the weekly recording plan.
--
-- Every planner user - students and the owner - answers a short quiz once and
-- places their week on a calendar: three recording sessions at a reserved
-- time, ideate / A-B test days, and an optional backup day. The answers live
-- on user_settings; the week is one row per block in plan_blocks.
--
-- Re-runnable: columns and table are guarded, the policy is dropped first.

alter table public.user_settings add column if not exists student_name text default null;
alter table public.user_settings add column if not exists timezone text default null;
alter table public.user_settings add column if not exists goal text default null;
alter table public.user_settings add column if not exists wish text default null;
alter table public.user_settings add column if not exists minutes_per_day integer default null;
alter table public.user_settings add column if not exists onboarded_at timestamptz default null;

alter table public.user_settings drop constraint if exists user_settings_minutes_per_day_check;
alter table public.user_settings
  add constraint user_settings_minutes_per_day_check check (minutes_per_day in (60, 90, 120, 180));

do $$ begin
  create type public.plan_block_kind as enum ('record', 'ideate', 'backup');
exception when duplicate_object then null; end $$;

create table if not exists public.plan_blocks (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  kind             public.plan_block_kind not null,
  weekday          integer not null check (weekday between 0 and 6),
  start_minute     integer not null check (start_minute between 0 and 1439),
  duration_minutes integer not null check (duration_minutes > 0 and duration_minutes <= 720),
  updated_at       timestamptz not null default now()
);

create index if not exists plan_blocks_user_id_idx on public.plan_blocks (user_id);

alter table public.plan_blocks enable row level security;
drop policy if exists plan_blocks_owner on public.plan_blocks;
create policy plan_blocks_owner on public.plan_blocks for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
