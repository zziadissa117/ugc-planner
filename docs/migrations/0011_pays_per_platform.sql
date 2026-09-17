-- 0011 - campaigns that pay for each platform separately.
--
-- The app's rule is that one video cross-posted everywhere is one deliverable
-- earning once. That rule is right for most contracts and it is what stops the
-- account list multiplying his earnings, which it once did: a campaign paying
-- $35 for one post a day read as $105/day because it had three platforms.
--
-- Some deals are genuinely not like that. Pump.Fun pays per post per platform,
-- so the same video on Instagram, TikTok and YouTube earns three times. There
-- is no way to tell those two apart from the data - they look identical - so
-- the campaign has to say which it is, and it defaults to the safe one.
--
-- This changes what a deliverable is WORTH and nothing else. The daily
-- obligation, the posting grid and the phase chain are untouched.
--
-- Re-runnable: the column add is guarded, and `not null default false` fills
-- existing rows with the behaviour they already had.
--
-- Apply to a database provisioned before this column existed. A project
-- provisioned from the current schema.sql already has it and must skip this.

alter table campaigns
  add column if not exists pays_per_platform boolean not null default false;
