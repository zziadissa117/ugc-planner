-- 0018 - archive a campaign instead of deleting it.
--
-- Applied to the live project (uykuoibqdxmpbbrsmyad) on 2026-10-02 after the
-- owner approved it, recorded as `campaign_archive`.
--
-- archived_at is null for every existing row, so nothing changes until he
-- archives something. Re-runnable.

alter table campaigns add column if not exists archived_at timestamptz default null;
create index if not exists campaigns_archived_idx on campaigns (user_id) where archived_at is not null;
