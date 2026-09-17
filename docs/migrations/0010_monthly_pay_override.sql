-- 0010 - what a campaign really pays a month.
--
-- The app estimates a month as pay_per_video_cents x daily_post_quota x 30.
-- That is right for a straight per-post deal and wrong for the two that are
-- not: Pump.Fun is a $1,000-3,000 monthly retainer, and Inflow pays per
-- completed 60-post cycle. Neither can be expressed as a per-video rate, so
-- the figure needs somewhere to be corrected by hand.
--
-- Null means "no correction, use the estimate", never zero - a campaign he has
-- not corrected is not one paying nothing. The check keeps a negative out; the
-- app stores integer cents and never a float.
--
-- Re-runnable: the column add is guarded, and the check rides along with it
-- rather than being added separately, because a bare `add constraint` has no
-- `if not exists` and would abort a second run.
--
-- Apply to a database provisioned before this column existed. A project
-- provisioned from the current schema.sql already has it and must skip this.

alter table campaigns
  add column if not exists monthly_pay_override_cents integer default null
    check (monthly_pay_override_cents >= 0);
