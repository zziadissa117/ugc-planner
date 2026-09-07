-- 0009 - the login that belongs to each account.
--
-- Email and password used to be campaign-level fields (account_email,
-- account_password in campaign_fields), which could only ever describe one
-- login per campaign. A creator runs a separate account per platform, so the
-- login belongs beside the handle on campaign_accounts, not on the campaign.
--
-- Stored as typed, in the clear - see the comment in docs/schema.sql. Nothing
-- is migrated across from the old campaign_fields rows: those said which login
-- the campaign used, not which platform's login it was, and splitting one
-- value across several accounts would be a guess about which account it
-- belongs to.
--
-- Apply to a database provisioned before this column pair existed. A project
-- provisioned from the current schema.sql already has them and must skip it.

alter table campaign_accounts add column if not exists email text;
alter table campaign_accounts add column if not exists password text;
