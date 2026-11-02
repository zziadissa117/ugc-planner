-- 0021: new accounts come in through an invite link, and nothing else.
--
-- 0020 closed sign-ups outright. He then wanted to let a class of students in
-- without reopening them to anyone who finds the URL: a link like
-- /join/<code> may create an account, the plain URL only signs in. One link
-- per group, capped at a number of accounts, and he can switch it off.
--
-- The app sends the code as user metadata with the sign-in request
-- (signInWithOtp's `data`), which is where it lands on the new auth.users row.
-- The check runs on that insert, so it holds for every route into auth.users
-- - magic link, password sign-up, anything calling the auth API directly. No
-- code, an unknown code, a switched-off link or a full one: the insert is
-- refused and no account exists.
--
-- AFTER rather than BEFORE: the use row references the new user, which has to
-- exist first. Raising here still undoes the insert. The link row is locked
-- for the count, so two students signing up at the same moment cannot both
-- take the last place.
--
-- Who joined is a row per account, counted at query time - not a counter on
-- the link that could drift from it. Deleting an account deletes its use and
-- frees the place.
--
-- Both tables are server-only: RLS on with no policies, so the browser can
-- neither read nor write them. The `invites` Edge Function reads and writes
-- them with the service role, for the owner only (_shared/owner.ts).
--
-- To add someone by hand from the dashboard, give them a link instead.
--
-- Re-runnable.

create table if not exists public.invite_links (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Za-z0-9_-]{16,}$'),
  max_uses integer not null check (max_uses > 0),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  switched_off_at timestamptz
);

create table if not exists public.invite_uses (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.invite_links (id) on delete cascade,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  email text,
  joined_at timestamptz not null default now()
);

create index if not exists invite_uses_invite_id_idx on public.invite_uses (invite_id);

alter table public.invite_links enable row level security;
alter table public.invite_uses enable row level security;
revoke all on public.invite_links from anon, authenticated;
revoke all on public.invite_uses from anon, authenticated;

create or replace function public.admit_invited_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite public.invite_links%rowtype;
  joined integer;
  supplied text := nullif(trim(new.raw_user_meta_data ->> 'invite_code'), '');
begin
  if supplied is null then
    raise exception 'New accounts need an invite link.';
  end if;

  select * into invite from public.invite_links where code = supplied for update;
  if not found then
    raise exception 'This invite link is not valid.';
  end if;
  if invite.switched_off_at is not null then
    raise exception 'This invite link has been switched off.';
  end if;

  select count(*) into joined from public.invite_uses where invite_id = invite.id;
  if joined >= invite.max_uses then
    raise exception 'This invite link is full.';
  end if;

  insert into public.invite_uses (invite_id, user_id, email) values (invite.id, new.id, new.email);
  return null;
end;
$$;

revoke all on function public.admit_invited_account() from public, anon, authenticated;

-- What the /join page asks before showing the email box, and again when a
-- request is refused: the auth API answers the app's requests with "Database
-- error saving new user" whatever the trigger said, so the reason has to be
-- asked for. It says only open/off/full/invalid about a code the caller
-- already holds - nothing about who joined, and nothing without the code.
create or replace function public.invite_link_status(p_code text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when l.id is null then 'invalid'
    when l.switched_off_at is not null then 'off'
    when (select count(*) from public.invite_uses u where u.invite_id = l.id) >= l.max_uses then 'full'
    else 'open'
  end
  from (select 1) as one
  left join public.invite_links l on l.code = p_code;
$$;

revoke all on function public.invite_link_status(text) from public;
grant execute on function public.invite_link_status(text) to anon, authenticated;

-- 0020's blanket refusal is replaced, not stacked: with both, nobody could
-- ever join.
drop trigger if exists refuse_new_accounts on auth.users;
drop function if exists public.refuse_new_accounts();

drop trigger if exists admit_invited_account on auth.users;
create trigger admit_invited_account
  after insert on auth.users
  for each row execute function public.admit_invited_account();
