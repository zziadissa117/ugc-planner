-- 0008 - timestamps required for reliable incremental pull.
--
-- Apply to a database that has already run schema.sql (migration 0001) and
-- prior numbered migrations without these columns. A project provisioned from
-- the current schema.sql already has them and must skip this file.

alter table campaign_angles add column updated_at timestamptz not null default now();
alter table campaign_rules add column updated_at timestamptz not null default now();
alter table bonus_tiers add column updated_at timestamptz not null default now();
alter table bonus_claims add column updated_at timestamptz not null default now();
alter table time_estimates add column updated_at timestamptz not null default now();
