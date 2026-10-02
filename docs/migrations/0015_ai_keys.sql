-- 0015 - bring-your-own AI key.
--
-- Applied to the live project (uykuoibqdxmpbbrsmyad) on 2026-10-02 after the
-- owner approved it, recorded as `ai_keys`. The apply tool hung on any statement
-- containing a delete or a drop, so it went in one statement at a time, and
-- delete_ai_key was run by hand in the SQL editor.
--
-- A user's model API key, encrypted at rest, tied to their account, readable
-- only by Edge Functions.
--
-- Why this table is NOT in schema.sql and is not mirrored locally: it is
-- server-only by design. A key must never reach Dexie, the outbox, the JSON
-- export or any pull. schema.sql feeds the generated TableName list that
-- drives all of those, so putting it there would make it a synced table.
-- (The cutter app's cutter_* tables share this project and are kept out of
-- schema.sql for the same reason.) A fresh project needs schema.sql AND this.
--
-- Encryption: Supabase Vault (authenticated encryption, key held outside the
-- database, so a dump of this table or of vault.secrets is not enough to read
-- a key). The key itself lives in vault.secrets; this table holds only the
-- pointer and the last four characters used for the masked display.
--
-- Access model:
--   * the browser can read provider + key_last4 + updated_at of its OWN row
--     (column grant + RLS) - never the secret, never the vault id;
--   * the browser cannot insert, update or delete: all writes go through the
--     `ai-key` Edge Function, which validates the key with the provider first;
--   * the three functions below touch the vault and are executable by the
--     service role only. The user id is passed in by the Edge Function from
--     the verified session, never taken from the request body.
--
-- Re-runnable.

create table if not exists public.user_ai_keys (
  user_id         uuid not null references auth.users(id) on delete cascade,
  -- 'anthropic' today. A format check rather than an enum or a list, so adding
  -- another provider is code, not a migration.
  provider        text not null check (provider ~ '^[a-z][a-z0-9_]{1,30}$'),
  vault_secret_id uuid not null,
  key_last4       text not null check (char_length(key_last4) = 4),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (user_id, provider)
);

alter table public.user_ai_keys enable row level security;

drop policy if exists user_ai_keys_read_own on public.user_ai_keys;
create policy user_ai_keys_read_own on public.user_ai_keys
  for select to authenticated
  using (user_id = (select auth.uid()));

-- RLS is per row; this is per column. Without it a signed-in user could select
-- vault_secret_id. No insert/update/delete grant at all.
revoke all on public.user_ai_keys from anon, authenticated;
grant select (user_id, provider, key_last4, updated_at) on public.user_ai_keys to authenticated;

-- Store (or replace) a key. Returns the last four characters.
create or replace function public.save_ai_key(p_user uuid, p_provider text, p_key text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing uuid;
  new_id   uuid;
  last4    text := right(p_key, 4);
begin
  select vault_secret_id into existing
    from public.user_ai_keys
   where user_id = p_user and provider = p_provider;

  if existing is not null then
    perform vault.update_secret(existing, p_key);
    update public.user_ai_keys
       set key_last4 = last4, updated_at = now()
     where user_id = p_user and provider = p_provider;
  else
    new_id := vault.create_secret(p_key, 'ai_key:' || p_user::text || ':' || p_provider);
    insert into public.user_ai_keys (user_id, provider, vault_secret_id, key_last4)
    values (p_user, p_provider, new_id, last4);
  end if;

  return last4;
end;
$$;

-- The decrypted key, or null when none is saved.
create or replace function public.get_ai_key(p_user uuid, p_provider text)
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select s.decrypted_secret
    from public.user_ai_keys k
    join vault.decrypted_secrets s on s.id = k.vault_secret_id
   where k.user_id = p_user and k.provider = p_provider;
$$;

-- Remove the key and its vault secret. True when there was one.
create or replace function public.delete_ai_key(p_user uuid, p_provider text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing uuid;
begin
  select vault_secret_id into existing
    from public.user_ai_keys
   where user_id = p_user and provider = p_provider;
  if existing is null then
    return false;
  end if;

  delete from public.user_ai_keys where user_id = p_user and provider = p_provider;
  delete from vault.secrets where id = existing;
  return true;
end;
$$;

revoke all on function public.save_ai_key(uuid, text, text)   from public, anon, authenticated;
revoke all on function public.get_ai_key(uuid, text)          from public, anon, authenticated;
revoke all on function public.delete_ai_key(uuid, text)       from public, anon, authenticated;
grant execute on function public.save_ai_key(uuid, text, text) to service_role;
grant execute on function public.get_ai_key(uuid, text)        to service_role;
grant execute on function public.delete_ai_key(uuid, text)     to service_role;
