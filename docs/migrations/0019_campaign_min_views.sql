-- 0019 - a campaign's minimum views per video, for the views tracker.
--
-- Applied to the live project (uykuoibqdxmpbbrsmyad) on 2026-10-19 after the
-- owner approved it, recorded as `campaign_min_views`.
--
-- Null for every existing campaign, so nothing changes until he sets one.
-- Re-runnable.

-- One statement, the check inside it: a second run skips the whole clause.
alter table campaigns add column if not exists min_views integer default null check (min_views is null or min_views > 0);
