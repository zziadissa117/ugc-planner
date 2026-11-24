# Postiz per student, and the coach view

Two server features for the students he coaches:

1. **Postiz per student.** Each student saves their own Postiz API key in
   SETUP. The planner reads *their* posts from Postiz - each video's live link,
   a preview, its status and its views - for IDEATE (average / best / worst
   views per campaign) and Today's "Going out today / this week".
2. **The coach view.** The owner sees each student's week - campaigns,
   accounts, ticked posts, earnings, ideate notes, Trybe videos, their Postiz
   posts and views - and writes them notes ("notes from Ziad").

| Piece | File |
| --- | --- |
| Client contracts | `src/sync/postizPosts.ts`, `src/sync/coach.ts` |
| Key storage | `supabase/functions/ai-key` (provider `postiz`), vault via `0015_ai_keys.sql` |
| Reading Postiz | `supabase/functions/_shared/postizPosts.ts` (fetching, database) |
| Its rules | `supabase/functions/_shared/postizRules.ts` (pure; `src/postizRules.test.ts`) |
| The student's own posts | `supabase/functions/postiz-posts` |
| The coach | `supabase/functions/coach`, rules in `_shared/coachRules.ts` (`src/coachRules.test.ts`) |
| Tables | `docs/migrations/0026_postiz_posts.sql` (server only), `0025_coach_notes.sql` (synced, pull only) |

## `postiz-posts`

```
POST { from: ISO, to: ISO }
  -> { connected: boolean, posts: PostizPostView[], reading: number, error?: string }

PostizPostView = {
  id,                 // Postiz post id
  group,              // Postiz's group: one video sent to several accounts shares it (null if none)
  platform,           // 'Instagram' | 'TikTok' | 'YouTube' | 'Facebook' | 'X' | ... (Postiz's word if unknown)
  handle,             // the account's handle, no @ ('' when Postiz's account list does not have it)
  url,                // releaseURL - the video on the platform, or null
  preview, previewKind,   // see "Previews" below
  caption,            // the post's text (Postiz keeps HTML; tags are stripped)
  status,             // 'scheduled' (QUEUE) | 'posted' (PUBLISHED) | 'failed' (ERROR)
  publishedAt,        // when it goes or went out
  views, viewsAt      // null until Postiz has given a number - never a guess
}
```

Any signed-in user, for their own key; the user id is the session's, never
the body's. Every post scheduled or out with `publishedAt` in `[from, to)`,
newest first - the range may include the future. Drafts are not posts. A
repeating Postiz post appears once (its first time in the range).

- No key saved: `{ connected: false, posts: [], reading: 0 }`, status 200.
- `reading`: posted videos in the range with no number yet that will still be
  asked for one.
- `error`: why Postiz could not be read this time, in plain words (key
  refused, no subscription, too many requests, Postiz down, hour used up).
  What was read before is still in `posts`.
- A bad range (not ISO, `to <= from`, over 62 days): 400 `{ error }`.

## `coach`

Owner only (`_shared/owner.ts`). Anyone else gets `{ enabled: false }` and
nothing, whatever the action.

```
{ action: 'students' }
  -> { enabled: true, students: StudentSummary[] }        // sorted by name, else email

{ action: 'student', student_id, from: ISO, to: ISO }
  -> { enabled: true, week: StudentWeek }
     404 { error } when student_id is not in invite_uses

{ action: 'save_note', student_id, id?, campaign_id, post_id, post_url, week_start, body }
  -> { note: CoachNoteRow }

{ action: 'delete_note', id }
  -> { deleted: boolean }
```

**Who is a student:** an account with a row in `invite_uses` - it came in
through an invite link. Every action that names a student checks this first,
so the owner gate never becomes "read any account".

**`StudentSummary`:** `id`, `email` (from `invite_uses`), `name` and `goal`
(`user_settings.student_name`, `goal`), `joinedAt`, `onboardedAt`,
`postizConnected` (a `postiz` row in `user_ai_keys`), and `lastActiveAt`.

`lastActiveAt` is an approximation: one query per table for the whole class -
`user_settings`, `plan_blocks`, `campaigns`, `campaign_accounts`, `videos`,
`video_posts`, `trybe_videos`, `ideate_notes` by `updated_at`,
`earnings_events` by `occurred_at` - newest first, 1,000 rows each, and the
latest per student across them. A student with nothing in a table's newest
1,000 has nothing there newer than its cut-off, so their latest comes from
the other tables (`user_settings` has one row each and always makes it). A
table the project does not have yet adds nothing rather than failing the list.

**`StudentWeek`** for `[from, to)`:

| Field | What |
| --- | --- |
| `settings` | their `user_settings` row, or null |
| `planBlocks` | the latest save only: the blocks sharing the latest `updated_at` |
| `campaigns`, `accounts` | all of them; **`password` is always null** - the coach has no use for a student's login |
| `videoPosts` | `video_posts` with `posted_at` in the range |
| `videos` | videos with `posted_at` in the range, plus any those posts belong to |
| `earnings` | `earnings_events` with `earned_on` in the range's days (see below) |
| `ideateNotes` | every note with `week_start` before the range's end (newest week first, 500 at most) |
| `coachNotes` | every note to this student (newest first, 500 at most) |
| `trybeVideos` | count of `trybe_videos` made in the range |
| `posts` | `PostizPostsAnswer` read with the **student's** key - it spends their hourly allowance, shared with their own screens |

`earned_on` and `week_start` are calendar days and the range is instants (the
coach's local midnights). Each bound is read as the day whose midnight is
nearest in UTC, which is exact for midnights anywhere from UTC-11 to UTC+11.

**Notes.** `body` 1 to 4,000 characters (trimmed); `week_start` null or a
Sunday; `campaign_id` null or one of the student's campaigns; `post_url` null
or an http(s) link. Insert sets `id`, `user_id` = student, `author_id` =
caller, `created_at` and `updated_at`; an edit (with `id`) only touches a note
he wrote to that student, and sets `updated_at`. `updated_at` is set
explicitly on every write: it is the sync pull's cursor and there is no
trigger, so an edit that did not move it would never reach the student.

**A deleted note does not reach the student.** `delete_note` deletes only
notes he wrote, but sync pulls never delete: a device that already pulled the
note keeps showing it. Accepted for now.

## Reading Postiz

Base `https://api.postiz.com/public/v1`, header `Authorization: <key>`:

- `GET /integrations` - the accounts: `id`, `name`, `identifier` (platform),
  `profile` (handle), `disabled`. Kept 12 hours, read again sooner when a post
  names an account it does not have.
- `GET /posts?startDate&endDate` - the range's posts. Kept 15 minutes per
  range (a week read covers its days). Each read upserts the posts (views
  untouched) and deletes the cached ones Postiz no longer has in that range.
- `GET /analytics/post/:id?date=30` - one post's views, brought to one number
  by `postViewCount` (ported from the cutter's `postiz/postViews.ts`).

**When views are read.** A posted video is due when it has never been asked
(from an hour after it went out, at any age - a student who connects Postiz
today still gets last week's numbers), or when it has passed 24h, 72h or 168h
since going out and not been asked since, until 8 days (the cutter's
`POST_VIEW_AGES_H`). Never-asked first, newest first; then the longest since
asked. At most 15 per call, five at a time, none started after 20 seconds.
A video is claimed before it is read (`views_checked_at` moves only if nobody
moved it), so two calls at once never read the same one. An answer with no
number is still "asked" - read again at the next age. Scheduled and failed
posts are never read.

**Previews.** Confirmed in Postiz's source (gitroomhq/postiz-app:
`public.integrations.controller.ts` `GET /posts` ->
`posts.repository.ts` `getPosts`): the public list selects `id, content,
publishDate, releaseURL, releaseId, state, error, intervalInDays, group,
creationMethod, settings, tags, integration{id, providerIdentifier, name,
picture}` - **not** the post's media (`image`). So in practice:

- YouTube: `https://img.youtube.com/vi/<id>/hqdefault.jpg` from the video id
  in `releaseURL` (`previewKind: 'image'`);
- TikTok: `thumbnail_url` from TikTok's public oEmbed,
  `https://www.tiktok.com/oembed?url=<releaseURL>` (no key, made for
  embedding), for posted videos whose link is a tiktok.com video, server-side.
  Kept in `thumb_url` / `thumb_at`; asked again after 24 hours (6 when TikTok
  had none - a video just out can be unknown to it for a while), or within an
  hour of the link's own `x-expires`, and never returned once that has passed.
  Not Postiz requests, so not counted against the allowance: at most 10 a call,
  5 at a time, 5-second timeout, run alongside the views. A 4xx is kept as
  "none"; a timeout or 5xx is asked again next call; neither ever fails the
  answer;
- Instagram and everything else: `preview: null`. Instagram has no
  token-free official source, and no page is ever scraped.

The screen can borrow a TikTok or YouTube preview for the same video's
Instagram post through `group`.

`previewOf` still reads `image` (a JSON list of `{ path, thumbnail? }`) if a
later Postiz sends it: a thumbnail is used first, else the file -
`'video'` for .mp4/.mov/.m4v/.webm, `'image'` otherwise.

## The allowance

Postiz allows 30 requests an hour per key and counts the ones it refuses.
Every Postiz request from `postiz-posts` and from `coach` (a student's week)
is taken from one per-user count in `postiz_state` first:

- **25 an hour.** A new hour starts an hour after the last began.
- **After a 429**, nothing at all until the hour is out (at least 15 minutes),
  for that user, from either function.
- **Race-safe:** each take reads the row, works out the grant (pure `grant()`),
  and writes it only if `version` has not moved - else it reads again. Today
  asks for today and for the week at the same moment.
- **A new key** (a different fingerprint - the first 16 hex characters of its
  SHA-256) starts the cache and the count over. Removing the key drops the
  cache but keeps the count, so remove-and-paste cannot buy a fresh hour.
- **A key the cutter also posts with.** The cutter keeps its own count for a
  key in `cutter_config` (`postiz-use:<the same fingerprint>`). When that row
  exists, the planner takes at most **8 an hour**, **none** while the cutter
  has used 12 or more of its current hour (its own read share - the rest is
  for posting), and none while the cutter is waiting out a 429. The planner
  only reads that row, never writes it, so the cutter does not see the
  planner's requests: in the worst hour (the cutter posting its full 28 after
  the planner took 8) Postiz could still turn one of the cutter's away. If
  that ever happens, the fix is for the planner to add its requests to the
  cutter's count.

Not counted: the one `GET /integrations` that `ai-key` makes to check a key
when it is saved.

## Tables (0026, server only)

`postiz_posts` (pk `user_id, post_id`) - the cache, with `post_group`,
`views`, `views_at` (when the number was read), `views_checked_at` (when
Postiz was last asked, whatever it said) and `thumb_url` / `thumb_at` (the
TikTok oEmbed thumbnail and when it was asked for). `postiz_state` (pk `user_id`) - key fingerprint, account
list, fetched ranges, and the allowance (`window_start`, `used`,
`busy_until`, `version`).

RLS on, no policies, every grant revoked from `anon` and `authenticated`:
only the Edge Functions (service role) touch them. Not in `schema.sql` for the
same reason as `user_ai_keys`: everything there becomes a synced, exported,
locally mirrored table the browser writes.

## Deploying

Nothing here has been deployed or run against the live project.

1. SQL, in the SQL editor, in this order (each is re-runnable; skip one the
   project already has - check with
   `select version, name from supabase_migrations.schema_migrations`, or by
   asking the REST API for the table):
   1. `docs/migrations/0025_coach_notes.sql`
   2. `docs/migrations/0026_postiz_posts.sql`

   `0015_ai_keys.sql` and `0024_trybe_and_ideate.sql` (which the coach reads)
   are already applied; a Postiz key needs no migration.
2. Functions:

   ```
   npx supabase functions deploy postiz-posts coach ai-key --project-ref uykuoibqdxmpbbrsmyad
   ```

   JWT verification stays on (the default). The CLI bundles `_shared/` from
   the imports. `ai-key` is redeployed because it gained the `postiz`
   provider.
3. Secrets: none new. The coach uses the owner gate's
   `PLANNER_ADMIN_USER_IDS` (or `CUTTER_BRIDGE_USER_IDS` until that is set),
   already set for `invites` and `planner-postiz`.
4. Check by querying, not by the absence of an error: save a Postiz key in
   SETUP, open IDEATE, then
   `select count(*), count(views) from postiz_posts where user_id = '<id>'`
   and `select used, busy_until from postiz_state where user_id = '<id>'`.
