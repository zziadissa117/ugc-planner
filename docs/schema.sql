-- UGC production planner - initial schema
-- Money is stored in integer cents everywhere. Never floats.
-- Every table is RLS-protected and scoped to auth.uid().

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type setup_type as enum ('face', 'screen', 'phone', 'notalk');

create type session_type as enum ('film', 'edit', 'post', 'warm_up');

create type account_status as enum ('new', 'warming', 'ready');

create type hook_source as enum ('generated', 'user_entered');

-- The phase chain. Not every campaign uses every phase; the campaign's
-- approval_mode decides which links are in its chain.
create type video_phase as enum (
  'awaiting_brief',            -- brand-scripted campaigns only
  'awaiting_script_approval',  -- script-approval campaigns only
  'to_film',
  'filmed',
  'edited',
  'submitted',
  'approved',
  'posted'
);

create type approval_mode as enum (
  'none',            -- film -> edit -> post
  'video',           -- film -> edit -> submit -> approved -> post
  'script_and_video',
  'brand_scripted'
);

-- What kind of obligation a video represents. Keeps contracted work separate
-- from warm-up and from wider-topic content whose pay status is unresolved.
create type video_kind as enum (
  'contracted',
  'warm_up',
  'wider_topic',
  'no_quota'
);

-- The honesty enum. This is the point of campaign_fields.
create type field_source as enum (
  'documented',         -- read from the brief/contract AND confirmed by the user
  'parsed_unreviewed',  -- extracted by the parser, not yet confirmed. Amber.
  'user_entered',       -- typed by the user, no document backing
  'missing'             -- known to be absent. Renders "not saved yet".
);

create type document_kind as enum ('brief', 'contract', 'other');

-- ---------------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------------

create table campaigns (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  name              text not null,
  company           text,
  is_active         boolean not null default true,

  approval_mode     approval_mode not null default 'none',
  default_setup     setup_type,

  -- Paid deliverables owed per day. THE source of truth for what a day owes
  -- and what a day is worth.
  --
  -- This was briefly demoted in favour of campaign_accounts.posts_per_day,
  -- and that was wrong: a campaign posting one video to three platforms owes
  -- ONE paid deliverable, not three, and reading the demand off the accounts
  -- made the number of platforms silently multiply both the daily obligation
  -- and the earnings. Accounts say WHERE a deliverable goes; this says HOW
  -- MANY there are. Nothing derives a quota from the account list.
  daily_post_quota  integer not null default 0 check (daily_post_quota >= 0),

  -- Pay cycle. Null cycle_size means paid per post with no cycle.
  pay_per_video_cents integer check (pay_per_video_cents >= 0),
  cycle_size          integer check (cycle_size > 0),

  -- What the campaign really pays a month, when he has told us.
  --
  -- The app estimates a month as pay_per_video_cents x daily_post_quota x 30,
  -- and that is often wrong for a reason no rate can express: Pump.Fun is a
  -- $1,000-3,000 monthly retainer, and Inflow pays out per completed 60-post
  -- cycle rather than per day. So this is his own figure, and where it is set
  -- it replaces the estimate everywhere.
  --
  -- Null means "no correction, use the estimate" - never zero. A campaign he
  -- has not corrected is not a campaign paying nothing.
  --
  -- `default null` on purpose: the generator makes a column optional in the
  -- New* insert types only when it has a default, and without one every
  -- createCampaign call site would have to pass it explicitly.
  monthly_pay_override_cents integer default null check (monthly_pay_override_cents >= 0),

  -- Whether each platform is paid separately for the same video.
  --
  -- The default is false and that is the rule almost everywhere: one video
  -- cross-posted to Instagram, TikTok and YouTube is ONE deliverable earning
  -- once, which is why nothing derives a quota from the account list and why
  -- this app once showed "$105/day" for a campaign paying $35.
  --
  -- But some contracts really do pay per platform - "pump.fun pay lets say 16$
  -- per post and it includes cross posting. So if i post the same video to ig
  -- and tiktok and yt its seperately 16$". That is a fact about the deal, not
  -- a miscount, and the only honest way to hold both is to let the campaign
  -- say which it is.
  --
  -- It changes what a deliverable EARNS and nothing else. The day still owes
  -- daily_post_quota videos, the Post grid still shows one column per
  -- deliverable, and a video is still posted once to each account.
  pays_per_platform boolean not null default false,

  -- Every posted video has to be submitted to the brand as well - Pump.Fun
  -- pays nothing for a post not submitted within two hours. When set, ticking
  -- a post asks him whether he submitted it. Set by him, never inferred.
  needs_submission boolean not null default false,

  -- Posts made before this app existed. User-entered, never fabricated.
  opening_post_count  integer not null default 0 check (opening_post_count >= 0),

  -- Set true when the source brief has missing sections / conversion damage.
  brief_is_incomplete boolean not null default false,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index on campaigns (user_id) where is_active;

-- Where this campaign actually posts. A video may be cross-posted to each
-- ready account, but is still one contractual deliverable.
--
-- email and password are the login for that one account, kept beside the
-- handle because they are looked up together, at the moment of posting, and
-- because one creator runs several accounts per platform across campaigns.
-- They are stored as typed, in the clear: this is a single-user local-first
-- app whose whole store is already readable to anyone holding the device, and
-- pretending otherwise with reversible obfuscation would be worse than saying
-- so plainly. No document ever states either (NEVER_PARSED_FIELDS).
create table campaign_accounts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  campaign_id   uuid not null references campaigns(id) on delete cascade,
  platform      text not null,
  handle        text,
  email         text default null,
  password      text default null,
  -- Retained for existing rows; the campaign's daily_post_quota is what the
  -- app reads. An account does not carry its own quota: see the comment on
  -- campaigns.daily_post_quota.
  posts_per_day integer not null default 0 check (posts_per_day >= 0),
  status        account_status not null default 'new',
  is_active     boolean not null default true,
  -- An account the campaign pays only through view-milestone bonuses, never
  -- per post: ticking it earns nothing and it is not owed. Polsia pays a
  -- retainer for YouTube and Instagram and only a bonus for Facebook. Set by
  -- him, never inferred.
  bonus_only    boolean not null default false,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (campaign_id, platform)
);

create index on campaign_accounts (campaign_id);
create index on campaign_accounts (user_id, status);

-- Raw uploaded documents. Kept forever so the brief page renders the real thing.
create table campaign_documents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  kind         document_kind not null,
  filename     text,
  raw_text     text not null,
  uploaded_at  timestamptz not null default now()
);

create index on campaign_documents (campaign_id);

-- Every extracted or entered value, with its provenance attached.
-- A pay rate that came from the parser is structurally a different row from
-- one the user confirmed. UI cannot collapse them by accident.
create table campaign_fields (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  campaign_id   uuid not null references campaigns(id) on delete cascade,
  field_key     text not null,          -- 'submission_url', 'handle_tiktok', ...
  field_value   text,
  source        field_source not null,
  -- The exact substring the parser claims this came from. Validated against
  -- the document text before insert; anything unverifiable is stored 'missing'.
  source_quote  text,
  source_document_id uuid references campaign_documents(id) on delete set null,
  confirmed_at  timestamptz,
  updated_at    timestamptz not null default now(),

  unique (campaign_id, field_key),

  -- A parsed field is by definition unconfirmed.
  constraint parsed_is_unconfirmed
    check (source <> 'parsed_unreviewed' or confirmed_at is null),
  -- A documented field must have been confirmed and must cite its source.
  constraint documented_needs_proof
    check (source <> 'documented'
           or (confirmed_at is not null and source_quote is not null)),
  -- A missing field holds no value.
  constraint missing_is_empty
    check (source <> 'missing' or field_value is null)
);

create index on campaign_fields (campaign_id);

-- Angles, hooks, structure notes. is_verified false = came from somewhere
-- other than the campaign's own documents (e.g. a skill file) and must be
-- displayed separately rather than merged into the documented list.
create table campaign_angles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  label        text not null,
  body         text,
  family       text,                    -- e.g. 'fear' / 'greed'
  is_verified  boolean not null default false,
  sort_order   integer not null default 0,
  updated_at   timestamptz not null default now()
);

create index on campaign_angles (campaign_id);

-- A usable opening and optional beats. Unlike campaign_fields, this is
-- authored text and carries who/what generated it rather than a source quote.
create table campaign_hooks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  campaign_id   uuid not null references campaigns(id) on delete cascade,
  angle_id      uuid references campaign_angles(id) on delete set null,
  body          text not null,
  outline       text,
  source        hook_source not null,
  model         text,
  generated_at  timestamptz,
  used_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint generated_names_its_model
    check (source <> 'generated' or (model is not null and generated_at is not null)),
  constraint user_entered_has_no_model
    check (source <> 'user_entered' or (model is null and generated_at is null))
);

create index on campaign_hooks (campaign_id, used_at);

-- The never-do list. Rendered in red.
create table campaign_rules (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  body         text not null,
  is_verified  boolean not null default false,
  sort_order   integer not null default 0,
  updated_at   timestamptz not null default now()
);

create index on campaign_rules (campaign_id);

-- ---------------------------------------------------------------------------
-- Videos
-- ---------------------------------------------------------------------------

create table videos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  campaign_id   uuid not null references campaigns(id) on delete cascade,

  kind          video_kind not null default 'contracted',
  setup         setup_type,
  angle_id      uuid references campaign_angles(id) on delete set null,

  -- Denormalized current phase so the NOW screen is one fast query.
  -- phase_events remains the authoritative history.
  phase         video_phase not null default 'to_film',

  script        text,

  -- Blocked is orthogonal to phase: a missing handle blocks posting, not filming.
  blocked_reason text,

  -- The day this video is owed for. Null for supply built ahead of demand.
  owed_for_date date,

  -- RATE SNAPSHOT. Written when the video reaches 'posted'. If the campaign's
  -- rate changes later, already-posted videos keep the rate they earned at.
  -- This is what makes the ledger non-rewritable.
  --
  -- Null means UNPRICED, not free. A campaign whose rate has not been confirmed
  -- yet still has to let its videos be posted - a missing detail must never
  -- hide work that could be done right now - and writing 0 there would put a
  -- fabricated "earned nothing" into the ledger.
  rate_snapshot_cents integer check (rate_snapshot_cents >= 0),
  posted_at     timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Posted implies a timestamp. It does NOT imply a rate.
  --
  -- This was posted_is_priced, which also required rate_snapshot_cents. That
  -- forced an unpriced post to snapshot 0, which reads as "earned nothing"
  -- when the truth is "no rate confirmed yet" - a fabricated figure in the one
  -- table that must never carry one. Null now means unpriced.
  --
  -- Phase 7 owes three things because of this: exclude unpriced videos from
  -- the DOCUMENTED base-earned figure, show their count in amber, and backfill
  -- the snapshot onto exactly those videos - no others - once the campaign's
  -- rate is confirmed.
  constraint posted_is_timestamped
    check (phase <> 'posted' or posted_at is not null)
);

create index on videos (user_id, phase);
create index on videos (campaign_id, phase);
create index on videos (owed_for_date);

-- Where a video went live. One video, possibly two platforms, still one
-- deliverable - which is contractual for Inflow.
create table video_posts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  video_id    uuid not null references videos(id) on delete cascade,
  account_id  uuid default null references campaign_accounts(id) on delete set null,
  platform    text not null,
  url         text,
  posted_at   timestamptz not null default now(),
  view_count  integer check (view_count >= 0),
  view_count_entered_at timestamptz,
  updated_at  timestamptz not null default now(),

  unique (video_id, platform),
  unique (video_id, account_id)
);

create index on video_posts (video_id);

-- ---------------------------------------------------------------------------
-- History. Append-only.
-- ---------------------------------------------------------------------------

-- Every phase transition. This is the only source of MEASURED timings, and it
-- is the reason history cannot be fabricated: it can be appended to, not edited.
create table phase_events (
  id           bigserial primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  video_id     uuid not null references videos(id) on delete cascade,
  from_phase   video_phase,
  to_phase     video_phase not null,
  session      session_type,
  work_session_id uuid default null,
  occurred_at  timestamptz not null default now(),
  -- Wall-clock seconds spent in the previous phase, when measurable.
  duration_seconds integer check (duration_seconds >= 0),

  -- Client-generated idempotency key.
  --
  -- `id` is a server sequence, so it means nothing until the row reaches the
  -- server: a push carries no id and lets the server assign one. That makes a
  -- push non-idempotent on its own - if it succeeds but the response is lost,
  -- the retry inserts the same event a second time, and duplicated events
  -- corrupt the MEASURED timings this log is the only source of.
  --
  -- The client mints this before the write lands locally, so a retry hits the
  -- unique constraint below and is treated as already applied.
  client_id    uuid not null default gen_random_uuid(),

  unique (user_id, client_id)
);

create index on phase_events (video_id, occurred_at);
create index on phase_events (user_id, to_phase, occurred_at);

-- One deliberate sitting. Progress is derived from phase_events, never
-- cached here, so it cannot drift away from the history that explains it.
create table work_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  campaign_id     uuid not null references campaigns(id) on delete cascade,
  kind            session_type not null,
  goal_videos     integer not null check (goal_videos > 0),
  planned_minutes integer not null check (planned_minutes > 0),
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ends_after_it_starts check (ended_at is null or ended_at >= started_at)
);

alter table phase_events
  add constraint phase_events_work_session_id_fkey
  foreign key (work_session_id) references work_sessions(id) on delete set null;

create index on work_sessions (campaign_id, started_at);
create index on work_sessions (user_id, started_at);

-- Every completed account warm-up session. Append-only, same reasoning as
-- phase_events: "warmed up twice" is a count taken from this log at query
-- time, never a mutable number on the campaign row, so it cannot be nudged
-- back down by an edit and cannot double-count a retried push.
create table warmup_events (
  id           bigserial primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  account_id   uuid default null references campaign_accounts(id) on delete cascade,
  -- How long this warm-up session ran. The session window he chose, not a guess.
  minutes      integer not null check (minutes > 0),
  occurred_at  timestamptz not null default now(),

  -- Same idempotency key as phase_events.client_id, for the same reason: a
  -- retried push must not double up a completed warm-up.
  client_id    uuid not null default gen_random_uuid(),

  unique (user_id, client_id)
);

create index on warmup_events (campaign_id, occurred_at);
create index on warmup_events (account_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Money. Three numbers that must never be summed.
-- ---------------------------------------------------------------------------

create table bonus_tiers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  campaign_id   uuid not null references campaigns(id) on delete cascade,
  label         text not null,
  threshold_views integer not null check (threshold_views > 0),
  payout_cents  integer not null check (payout_cents >= 0),
  -- Views only count within this many days of upload, per contract.
  view_window_days integer,
  updated_at    timestamptz not null default now(),

  unique (campaign_id, threshold_views)
);

create table bonus_claims (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  video_id      uuid not null references videos(id) on delete cascade,
  bonus_tier_id uuid not null references bonus_tiers(id) on delete cascade,

  -- EXPECTED: the user's own typed probability. Defaults to zero so the
  -- expected column reads $0 until they judge it. Never inferred.
  probability   numeric(3,2) not null default 0
                check (probability >= 0 and probability <= 1),

  -- USER ENTERED: only what was actually logged as received.
  received_cents integer check (received_cents >= 0),
  received_at    timestamptz,
  updated_at    timestamptz not null default now(),

  unique (video_id, bonus_tier_id),
  constraint received_needs_date
    check (received_cents is null or received_at is not null)
);

create index on bonus_claims (video_id);

-- ---------------------------------------------------------------------------
-- Settings and estimates
-- ---------------------------------------------------------------------------

-- Editable EST times per setup. MEASURED values are derived from phase_events
-- at query time once there are 2+ samples; they are never written here.
create table time_estimates (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  setup         setup_type not null,
  film_minutes  integer not null check (film_minutes > 0),
  edit_minutes  integer not null check (edit_minutes > 0),
  post_minutes  integer not null check (post_minutes > 0),
  updated_at    timestamptz not null default now(),

  unique (user_id, setup)
);

create table user_settings (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  setup_switch_minutes   integer not null default 10 check (setup_switch_minutes >= 0),
  -- Filmed-but-unedited count carried in from before the app existed.
  -- Ships null on purpose: the user fills it, we never guess.
  opening_unedited_count integer check (opening_unedited_count >= 0),
  last_export_at         timestamptz,
  updated_at             timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table campaigns          enable row level security;
alter table campaign_accounts  enable row level security;
alter table campaign_documents enable row level security;
alter table campaign_fields    enable row level security;
alter table campaign_angles    enable row level security;
alter table campaign_hooks     enable row level security;
alter table campaign_rules     enable row level security;
alter table videos             enable row level security;
alter table video_posts        enable row level security;
alter table phase_events       enable row level security;
alter table work_sessions      enable row level security;
alter table warmup_events      enable row level security;
alter table bonus_tiers        enable row level security;
alter table bonus_claims       enable row level security;
alter table time_estimates     enable row level security;
alter table user_settings      enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'campaigns','campaign_accounts','campaign_documents','campaign_fields','campaign_angles','campaign_hooks',
    'campaign_rules','videos','video_posts','bonus_tiers','bonus_claims',
    'time_estimates','work_sessions'
  ]
  loop
    execute format(
      'create policy %I_owner on %I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t || '_owner', t);
  end loop;
end $$;

create policy user_settings_owner on user_settings for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- phase_events is append-only: readable and insertable, never updated or deleted.
create policy phase_events_read on phase_events for select to authenticated
  using (user_id = (select auth.uid()));
create policy phase_events_append on phase_events for insert to authenticated
  with check (user_id = (select auth.uid()));

-- warmup_events is append-only in exactly the same way.
create policy warmup_events_read on warmup_events for select to authenticated
  using (user_id = (select auth.uid()));
create policy warmup_events_append on warmup_events for insert to authenticated
  with check (user_id = (select auth.uid()));
