-- 0005 - work sessions and account-aware posting.
--
-- Apply to a database that has already run schema.sql (migration 0001) and
-- 0002 through 0004 without these changes. A project provisioned from the
-- current schema.sql already has them and must skip this file.

create table work_sessions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade, kind session_type not null,
  goal_videos integer not null check (goal_videos > 0), planned_minutes integer not null check (planned_minutes > 0),
  started_at timestamptz not null default now(), ended_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint ends_after_it_starts check (ended_at is null or ended_at >= started_at)
);
create index on work_sessions (campaign_id, started_at);
create index on work_sessions (user_id, started_at);
alter table work_sessions enable row level security;
create policy work_sessions_owner on work_sessions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table phase_events add column work_session_id uuid default null references work_sessions(id) on delete set null;
alter table video_posts add column account_id uuid default null references campaign_accounts(id) on delete set null;
alter table video_posts add column updated_at timestamptz not null default now();
alter table video_posts add constraint video_posts_video_account_unique unique (video_id, account_id);
