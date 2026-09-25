-- 0012 - accounts a campaign pays only through bonuses.
--
-- Some campaigns pay for some of their platforms and not others: Polsia pays
-- a retainer for YouTube and Instagram, and only a view-milestone bonus for
-- Facebook. A tick on a bonus-only account earns nothing and is not part of
-- what the day owes. He sets this per account; nothing infers it, and it
-- defaults to the behaviour every account already had.
--
-- Re-runnable, and `not null default false` fills existing rows.
--
-- Apply to a database provisioned before this column existed. A project
-- provisioned from the current schema.sql already has it and must skip this.

alter table campaign_accounts
  add column if not exists bonus_only boolean not null default false;
