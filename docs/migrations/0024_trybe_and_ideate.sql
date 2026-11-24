-- 0024: Trybe videos and ideate notes, for the Today screen.
--
-- trybe_videos is one row per Trybe video he made - a video sent to a brand,
-- with no account to create. He runs a one-hour Trybe timer and taps
-- "+1 video" for each one. A day's or a week's count is counted from the rows
-- when asked, never stored. Rows are inserted, and deleted only to undo a
-- mistaken tap; never updated.
--
-- ideate_notes is what he writes in an ideate session about one campaign
-- account's posts in a week, for the next recording. account_id null is a
-- note about the campaign as a whole; week_start is the Sunday that starts the
-- week. Notes are edited and deleted freely.
--
-- Both are per user, owner-only, like every other synced table.
--
-- Re-runnable: tables and indexes are guarded, the policies are dropped first.

create table if not exists public.trybe_videos (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  made_at    timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trybe_videos_user_id_made_at_idx on public.trybe_videos (user_id, made_at);

alter table public.trybe_videos enable row level security;
drop policy if exists trybe_videos_owner on public.trybe_videos;
create policy trybe_videos_owner on public.trybe_videos for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table if not exists public.ideate_notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  account_id  uuid default null references public.campaign_accounts(id) on delete cascade,
  -- extract(dow) is 0 on a Sunday.
  week_start  date not null check (extract(dow from week_start) = 0),
  body        text not null check (char_length(body) between 1 and 4000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists ideate_notes_user_id_week_start_idx on public.ideate_notes (user_id, week_start);
create index if not exists ideate_notes_campaign_id_week_start_idx on public.ideate_notes (campaign_id, week_start);
create index if not exists ideate_notes_account_id_idx on public.ideate_notes (account_id);

alter table public.ideate_notes enable row level security;
drop policy if exists ideate_notes_owner on public.ideate_notes;
create policy ideate_notes_owner on public.ideate_notes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
