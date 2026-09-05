-- RLS verification. Run against the project after applying schema.sql, and
-- again after any policy change.
--
-- This exercises the policies as the `authenticated` role with real JWT claims,
-- which is exactly the mechanism PostgREST sets up per request: it sets `role`
-- and `request.jwt.claims`, and auth.uid() reads the `sub` out of them. So
-- these are the live policies doing the work, not a reading of them.
--
-- It is self-validating. Account A inserts a row and asserts it can see it,
-- and only then does account B look - so B's zero counts cannot be an empty
-- table passing for isolation.
--
-- Everything it writes, it deletes. Run it as the service role (the SQL editor
-- or the Supabase MCP), because it needs to switch roles.
--
-- Nothing here needs a confirmed account or a live client session. The one
-- thing it does NOT cover is the HTTP layer - that supabase-js sends the token
-- that produces these claims. That is what the two-account client test does.

do $$
declare
  -- Any real auth.users row: A must exist because user_id is a foreign key.
  a uuid := (select id from auth.users order by created_at limit 1);
  -- B never writes, so it does not need to exist.
  b uuid := '0000dead-0000-4000-8000-00000000beef';
  c_id uuid; v_id uuid; n int; before_phase text;
begin
  if a is null then
    raise exception 'no auth.users row to act as - create one account first';
  end if;

  -- ---- as account A -------------------------------------------------------
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', a::text, 'role', 'authenticated')::text, true);

  insert into campaigns (user_id, name) values (a, 'RLS probe') returning id into c_id;
  insert into videos (user_id, campaign_id) values (a, c_id) returning id into v_id;
  insert into phase_events (user_id, video_id, to_phase) values (a, v_id, 'to_film');

  select count(*) into n from campaigns where id = c_id;
  if n <> 1 then raise exception 'A cannot see its own campaign'; end if;

  -- ---- phase_events is append-only, even for the account that owns it ------
  --
  -- There is no UPDATE or DELETE policy, and RLS denies any command with no
  -- matching policy. Note what that looks like: not an error, but zero rows
  -- affected - the row is simply not visible to the command.
  select to_phase::text into before_phase from phase_events where video_id = v_id;

  update phase_events set to_phase = 'posted' where video_id = v_id;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'UPDATE on phase_events affected % rows for its owner', n; end if;

  delete from phase_events where video_id = v_id;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'DELETE on phase_events affected % rows for its owner', n; end if;

  select count(*) into n from phase_events where video_id = v_id;
  if n <> 1 then raise exception 'the event did not survive'; end if;
  if (select to_phase::text from phase_events where video_id = v_id) <> before_phase then
    raise exception 'the event was altered';
  end if;

  -- ---- as account B -------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', b::text, 'role', 'authenticated')::text, true);

  select count(*) into n from campaigns;    if n <> 0 then raise exception 'B saw % campaigns', n; end if;
  select count(*) into n from videos;       if n <> 0 then raise exception 'B saw % videos', n; end if;
  select count(*) into n from phase_events; if n <> 0 then raise exception 'B saw % events', n; end if;

  -- B must not be able to write a row it labels as A's, either.
  begin
    insert into campaigns (user_id, name) values (a, 'forged by B');
    raise exception 'B inserted a row owned by A';
  exception when insufficient_privilege then null;
  end;

  reset role;
  delete from phase_events where video_id = v_id;
  delete from videos where id = v_id;
  delete from campaigns where id = c_id;

  raise notice 'all RLS assertions passed';
end $$;

select 'rls behavioural checks passed' as result;
