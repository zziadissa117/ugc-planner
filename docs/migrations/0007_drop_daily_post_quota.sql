-- 0007 - remove the retired campaign-level quota.
--
-- Apply only after every client has upgraded to campaign_accounts. A project
-- provisioned from the current schema.sql before this cleanup still has the
-- compatibility column and must run this file only when its readers no longer
-- use it.

alter table campaigns drop column daily_post_quota;
