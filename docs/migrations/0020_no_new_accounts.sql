-- 0020: nobody new can get an account.
--
-- The magic link used to create an account for any address typed into it,
-- which is how two people he had shared the link with ended up with planners
-- of their own on his project. The client now asks for sign-in only
-- (shouldCreateUser: false), but the client is not what protects anything:
-- anyone with the publishable key can call the auth API directly. This is the
-- server-side half - every route into auth.users (magic link, password
-- sign-up, OAuth, anonymous, the dashboard's "Add user") ends in this insert.
--
-- To add someone on purpose: drop the trigger, add them, re-run this file.
-- The live tests that sign up for real (claim.live.test.ts, rls.live.test.ts)
-- are refused by it too.
--
-- Re-runnable.

create or replace function public.refuse_new_accounts()
returns trigger
language plpgsql
as $$
begin
  raise exception 'New accounts are closed on this project.';
end;
$$;

revoke all on function public.refuse_new_accounts() from public, anon, authenticated;

drop trigger if exists refuse_new_accounts on auth.users;
create trigger refuse_new_accounts
  before insert on auth.users
  for each row execute function public.refuse_new_accounts();
