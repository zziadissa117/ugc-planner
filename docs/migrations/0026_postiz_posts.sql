-- 0026 - what the planner has read from each user's own Postiz.
--
-- Written but NOT yet applied to the live project. Run after 0015 (the key
-- itself lives in user_ai_keys, provider 'postiz' - no migration needed for a
-- new provider) and after 0024/0025, which the `coach` function also reads.
--
-- Each student saves their own Postiz API key in SETUP. The `postiz-posts`
-- and `coach` Edge Functions read that student's posts from Postiz - each
-- video's live link, a preview and its views - through
-- supabase/functions/_shared/postizPosts.ts. Postiz allows 30 requests an
-- hour per key and reads views one post at a time, so what has been read is
-- kept here and only what is due is asked again. Contract and design:
-- docs/POSTIZ_AND_COACH.md.
--
-- Why these tables are NOT in schema.sql and are not mirrored locally: they
-- are server-only by design, like user_ai_keys (0015). They are a cache of
-- another service's answers plus a request count, written only by the Edge
-- Functions with the service role. schema.sql feeds the generated TableName
-- list that drives Dexie, the outbox, the pull and the JSON export, so putting
-- them there would make them synced tables the browser writes - and the
-- browser could then reset its own request count. A fresh project needs
-- schema.sql, 0015 and this.
--
-- Access model: RLS on with no policies and every grant revoked from anon and
-- authenticated, so the browser can neither read nor write them. Each row
-- belongs to the user whose key read it, and goes when the account does.
--
-- Re-runnable.

-- One row per post, per user: one video as it went (or goes) out on one
-- account. Views are null until Postiz has given a number - never a guess.
create table if not exists public.postiz_posts (
  user_id          uuid not null references auth.users(id) on delete cascade,
  -- Postiz's post id.
  post_id          text not null check (char_length(post_id) between 1 and 200),
  -- Postiz's group: the posts of one video sent to several accounts at once
  -- share it. (`group` is an SQL keyword, hence the prefix.)
  post_group       text,
  integration_id   text,
  -- The planner's platform name ('Instagram', 'TikTok', 'YouTube'...).
  platform         text not null default '',
  -- The account's handle as Postiz knows it, without the @.
  handle           text not null default '',
  -- The video on the platform.
  release_url      text,
  -- The post's own media, when Postiz sends it (its public list does not
  -- today), or YouTube's thumbnail for the video id in release_url.
  preview_url      text,
  preview_kind     text check (preview_kind in ('image', 'video')),
  caption          text not null default '',
  -- When it goes (or went) out.
  published_at     timestamptz,
  -- Postiz's state in the planner's words: QUEUE is scheduled, PUBLISHED
  -- posted, ERROR failed. Drafts are not kept.
  status           text not null check (status in ('scheduled', 'posted', 'failed')),
  views            bigint check (views >= 0),
  -- When `views` was read.
  views_at         timestamptz,
  -- When Postiz was last asked, whatever it said. Drives when it is asked
  -- again (a day, three days and a week after it went out).
  views_checked_at timestamptz,
  -- A posted TikTok video's thumbnail from TikTok's public oEmbed (no key),
  -- and when it was asked for - its CDN link expires, so it is asked again
  -- after a day. thumb_url null with a time: TikTok had none.
  thumb_url        text,
  thumb_at         timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (user_id, post_id),
  constraint views_are_dated check ((views is null) = (views_at is null))
);

create index if not exists postiz_posts_user_id_published_at_idx on public.postiz_posts (user_id, published_at);

alter table public.postiz_posts enable row level security;
revoke all on public.postiz_posts from anon, authenticated;

-- One row per user: what was read when, and this hour's request count.
create table if not exists public.postiz_state (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  -- The first 16 hex characters of the key's SHA-256 - never the key. A new
  -- key (a different fingerprint) starts the cache and the count over. The
  -- cutter files its own count for a key under the same fingerprint, which is
  -- how the planner notices a key the cutter also posts with.
  key_hash        text check (key_hash ~ '^[0-9a-f]{16}$'),
  -- GET /integrations as last read: [{ id, name, identifier, profile, disabled }].
  integrations    jsonb,
  integrations_at timestamptz,
  -- The ranges whose post list was read lately: [{ from, to, at }].
  ranges          jsonb not null default '[]'::jsonb,
  -- The hour's allowance: requests made since window_start, and nothing at
  -- all before busy_until (after Postiz answered 429).
  window_start    timestamptz,
  used            integer not null default 0 check (used >= 0),
  busy_until      timestamptz,
  -- Bumped on every change to the allowance; a write that finds it moved is
  -- read again, so two calls at once cannot both spend the last request.
  version         integer not null default 0,
  updated_at      timestamptz not null default now()
);

alter table public.postiz_state enable row level security;
revoke all on public.postiz_state from anon, authenticated;
