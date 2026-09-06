-- 0006 - generated and user-entered campaign hooks.
--
-- Apply to a database that has already run schema.sql (migration 0001) and
-- 0002 through 0005 without these changes. A project provisioned from the
-- current schema.sql already has them and must skip this file.

create type hook_source as enum ('generated', 'user_entered');
create table campaign_hooks (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references campaigns(id) on delete cascade,
  angle_id uuid references campaign_angles(id) on delete set null, body text not null, outline text,
  source hook_source not null, model text, generated_at timestamptz, used_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint generated_names_its_model check (source <> 'generated' or (model is not null and generated_at is not null)),
  constraint user_entered_has_no_model check (source <> 'user_entered' or (model is null and generated_at is null))
);
create index on campaign_hooks (campaign_id, used_at);
alter table campaign_hooks enable row level security;
create policy campaign_hooks_owner on campaign_hooks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
