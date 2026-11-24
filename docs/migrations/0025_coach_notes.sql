-- 0025: Notes from the coach to a student ("notes from Ziad").
--
-- coach_notes is written ONLY by the server: the `coach` Edge Function, using
-- the service role after checking the caller is the owner. The student it is
-- for reads it through the ordinary sync pull, and nothing else can: RLS has
-- one policy, SELECT for the student, and no insert, update or delete policy
-- at all. The browser can never write a row here - a student's device that
-- queued one would be refused forever, which is why the planner treats this
-- table as pull-only (PULL_ONLY_TABLES in src/data/local/db.ts).
--
-- campaign_id null is a note that is not about one campaign. post_id and
-- post_url are set when the note is about one video (a Postiz post id and its
-- live link). week_start, when set, is the Sunday that starts the week the
-- note is about.
--
-- The pull reads by updated_at, so the function must set updated_at = now()
-- on every edit or the edit never reaches the student.
--
-- Re-runnable: the table and indexes are guarded, the policy is dropped first.

create table if not exists public.coach_notes (
  id          uuid primary key default gen_random_uuid(),
  -- The student it is for.
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- The coach who wrote it.
  author_id   uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid default null references public.campaigns(id) on delete cascade,
  -- A Postiz post id when the note is about one video.
  post_id     text default null,
  -- That video's live link.
  post_url    text default null,
  -- extract(dow) is 0 on a Sunday.
  week_start  date default null check (week_start is null or extract(dow from week_start) = 0),
  body        text not null check (char_length(body) between 1 and 4000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Set when the coach deletes it. A pull never removes a row, so a hard
  -- delete would stay on a student's device for good; a dated deletion
  -- arrives like an edit, and the planner stops showing the note.
  deleted_at  timestamptz default null
);

-- For a project that ran this file before deleted_at was added.
alter table public.coach_notes add column if not exists deleted_at timestamptz default null;

create index if not exists coach_notes_user_id_updated_at_idx on public.coach_notes (user_id, updated_at);
create index if not exists coach_notes_campaign_id_idx on public.coach_notes (campaign_id);

alter table public.coach_notes enable row level security;
drop policy if exists coach_notes_read on public.coach_notes;
create policy coach_notes_read on public.coach_notes for select to authenticated
  using (user_id = (select auth.uid()));
