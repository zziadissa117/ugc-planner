-- 0017 - link a planner campaign to the cutter app's campaign.
--
-- Lets a video the cutter has posted tick the Post grid by itself. The cutter
-- keeps its own campaign ids (text), so this is text. Null = ticked by hand,
-- which is every existing row, so nothing changes until he picks one.
--
-- Re-runnable. A project provisioned from the current schema.sql already has it.

alter table campaigns
  add column if not exists cutter_campaign_id text default null;
