-- 0014 - the order he puts campaigns in on the Post screen.
--
-- The Post screen lists campaigns best-paying first. He wanted to arrange them
-- himself. Null keeps the best-pay order, so existing rows are unchanged.
--
-- Re-runnable. Apply to a database provisioned before this column existed; a
-- project provisioned from the current schema.sql already has it.

alter table campaigns
  add column if not exists post_position integer default null;

alter table campaigns drop constraint if exists campaigns_post_position_check;
alter table campaigns
  add constraint campaigns_post_position_check check (post_position >= 0);
