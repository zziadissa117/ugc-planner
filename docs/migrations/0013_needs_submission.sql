-- 0013 - campaigns whose videos must be submitted after posting.
--
-- Some brands only pay for a post once it has been submitted to them - Pump.Fun
-- within two hours of it going up. Ticking a post in the app submits nothing,
-- so a campaign with this set reminds him to. He sets it; nothing infers it.
--
-- Re-runnable, and `not null default false` fills existing rows.
--
-- Apply to a database provisioned before this column existed. A project
-- provisioned from the current schema.sql already has it and must skip this.

alter table campaigns
  add column if not exists needs_submission boolean not null default false;
