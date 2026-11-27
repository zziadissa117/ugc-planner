# CLAUDE.md

Working agreements for this repository. Read this and `docs/SPEC.md` before
writing any code. Re-read both when you are unsure; do not work from memory of
an earlier session.

## What this is

A UGC content planner that started as one creator's tool and is now **a system
for his UGC students** - he uses it too. A student (and he) records in batches
on three fixed days a week at a reserved time, starting each session with
Trybe videos (videos sent to brands, no account to create: a timer, as many as
you can), then base UGC - media maxing on the third day - and spends 2 to 4
hours on other days ideating. The onboarding quiz (`/start`) sets that week up
and makes the account at the end; see `src/data/weeklyPlan.ts`.

Five tabs:

- **TODAY** (`src/screens/Now.tsx`), top to bottom as he ordered it: the week
  as a calendar with a red now line, "Going out" (by campaign: videos out or
  scheduled today or this week against what it owes, "3 of 4", as small
  tiles two or three across - he found one row per campaign "too long
  vertically" - tap one for its videos, one line each, under its row; read
  only - `GoingOut.tsx`, `src/data/goingOut.ts`), today's
  sessions, the Trybe timer with "+1 video" (`trybe_videos`), a countdown
  "Used for warm-ups", and one "Hook generation" button (`/hooks`,
  `Hooks.tsx`). No posts row.
- **POST** (`Posting.tsx`): "X of Y posts done today" and the tick grid.
  Between each campaign's name and its Analytics button, what the cutter (or
  Postiz) has going out for it today and when - "1 posted · 9:04 am",
  "1 scheduled · 6:00 pm" (`LinedUpToday.tsx`, `videosByCampaign` in
  `goingOut.ts`). Read only, beside the name, never on a box.
- **CAMPAIGNS** (`Campaigns.tsx`, `NewCampaign.tsx`, `Campaign.tsx`): a
  campaign is typed in on one page - name, pay per video, videos a day,
  minimum views, platforms and accounts. High-quality campaigns (a minimum view
  count) are listed first, because they are recorded first. Money sits at the
  bottom of the list; there is no Money tab.
- **IDEATE** (`Ideate.tsx`, `IdeateBoard.tsx`): "All campaigns" first (less
  his personal brand, Instagram @ziadtps, at his request - `LEFT_OUT_OF_ALL`
  in `ideate.ts`; it still shows under its own campaign) - videos
  out, total / average / median views, 1K+ and 10K+ hit rates, best videos,
  by campaign, by platform, by day - then one campaign at a time: the same
  figures, "What's working" for that campaign only (best and weakest), by
  account, its videos as a grid of previews (tap opens the post on
  Instagram), "Notes from Ziad" (`coach_notes`, read only, pulled) and "Your
  notes" (`ideate_notes`). Unread views are never counted as zero. Videos and
  views come from the `postiz-posts` function (`src/sync/postizPosts.ts`): a
  key the silence cutter also posts with is answered from the cutter's own
  records (`cutter_posts` - every video, its campaign, links, the video file
  as its preview, the cutter's view readings; no Postiz request), any other
  key from Postiz (30 requests an hour, so views are kept server-side in
  `postiz_posts` and read a few at a time). Which campaign a video belongs
  to is one rule for IDEATE and Going out: `src/data/postHome.ts` - a cutter
  campaign the planner has no campaign for still shows, under its own name.
- **Coach** (`/coach`, `Coach.tsx`, owner only through the `coach` function):
  his students, each one's IDEATE, and notes to them. Notes he deletes are
  dated (`deleted_at`), never removed - pulls never delete rows.
- **SETUP** (`Settings.tsx`).

> Removed at his request and not to be rebuilt: the planner that packed his
> evening ("Do not rebuild a planner"), the FILM console and its goal, the
> EDIT backlog, the SHOOT teleprompter, the dictated to-do list, warm-up
> tracking per account (accounts are ready from the start - `canPostFrom` is
> always true), brief and contract upload and the parser review screen
> ("remove the brief/contract upload"), and the Money tab. The work clock and
> streak went with the old home screen.

## Stack - locked, do not substitute

- Vite + React + TypeScript
- Tailwind for styling
- `vite-plugin-pwa` for installability and offline
- Dexie (IndexedDB) for the local store
- Supabase (Postgres + Auth) for sync - **live**, project `uykuoibqdxmpbbrsmyad`
- Netlify for hosting - live at https://ugc-planner.netlify.app, see
  `docs/DEPLOY.md`

Do not add a state management library, a component library, an ORM, or an
analytics dependency. If you think one is needed, say so and stop.

## How persistence works

- `docs/schema.sql` is the authoritative shape. Mirror it exactly in the local
  store: same table names, same column names, same enums, same constraints
  enforced in code where IndexedDB cannot enforce them.
- All persistence goes through the `DataAdapter` interface, implemented by
  `LocalAdapter` over Dexie.
- **There is no SupabaseAdapter and there should not be.** Sync pushes *rows*;
  `DataAdapter` is an interface of *intents* (`advanceVideoPhase`,
  `confirmCampaignField`), and implementing those against Postgres would put
  the phase chain, the rate snapshot rule and the provenance rules on the
  server as a second copy free to drift from `src/data`. The remote side is
  `SyncTarget` in `src/sync`, row-level on purpose. See `docs/SYNC.md`.
- No component imports Dexie or `supabase-js` directly. Ever.
- Adding a table touches about ten files in a fixed order. The list is in
  `docs/migrations/README.md`; follow it rather than guessing.

## Non-negotiables

**Local-first.** Every write lands locally and returns immediately, then syncs
in the background through an outbox queue. No user action ever waits on a
network round trip. He taps "posted" on a phone with bad signal, in a hurry. If
that tap spins, the app is broken.

**Every write enqueues.** A write that lands locally and is not queued never
reaches the server, and nothing will ever notice: this was true of
`phase_events` for months and the entire history log silently stayed on one
device. Rows written inside a Dexie `upgrade()` bypass the queue by
construction - `backfillOutbox` exists for exactly that.

**Money is integer cents.** Never floats. Never a currency library.

**History is append-only.** `phase_events` and `earnings_events` are inserted
into and read from, never updated or deleted. Un-ticking a post appends a
reversal to `earnings_events`; it never edits or removes the original row. Anything countable is counted from it at query time -
how many videos an evening produced, how many warm-up sessions an account has
had - rather than kept as a number somewhere that can drift from the log that
explains it.

**Never invent campaign data.** No pay rate, quota, handle, submission URL,
angle, hook or rule may be written unless it came from the user, from an
uploaded document, or from a generator that says what wrote it. Missing values
render "not saved yet". A plausible guess is worse than a blank.

**Generated text says it was generated.** `campaign_hooks.source` is
`generated` or `user_entered`, and check constraints in both directions stop
one being mistaken for the other. A generated hook must name the model that
wrote it.

**Blue is the brand; every other colour is a state.** green = posted, bright
white = do this now, grey = later, amber = past the window you set or an
unconfirmed parsed field, red = blocked with the reason in plain words. The
deck's blue (`brand`, #86A8FF, and the #6585F5 -> #1D40C2 gradient) is the
look itself - the main button, the tab you are on, a section's caption - and
never means a state. No badges for anything that is not a state. One red is
not a state: the week calendar's now line (today's column, at the current
time) is red because he asked for "a little red line".

## Look and motion

**Every screen is in the UGC Roadmap look - the onboarding quiz's.** He asked
for it: "make the planner the same exact UI as it was with the quiz". It is his
sales-call deck brought up to date (spec: the cutter repo's
`docs/UGC_ROADMAP_STYLE.md`): near-black #0A0B0E with the deck's blue glow and
a faint dot grid behind the top of each screen, the UGC Roadmap logo top-left,
spaced blue capitals (`.kicker`) over bold cream titles (`.display`, #F4F3EF),
grey body text (#B9BCC4), softly rounded dark cards with a hairline highlight
(`Card` / `CARD_CLASS`), one blue gradient pill for the main action
(`buttonClass('now')`), quiet outlined pills for the rest, inputs that turn
blue on focus. Big tabular numbers are still each screen's headline
(`.numeric`, in the system face). It replaced the "instrument" look (pitch
black, hairlines, no cards), which is gone everywhere.

- Build from `src/components/ui.tsx` (screen headers, section labels, cards,
  buttons, disclosures, action tiles, state dots) and `styles.ts` (button,
  input and card classes, the `Tone` type). Do not re-type long class strings
  per screen. Full-page brand pages (the welcome and the quiz at `/start`)
  use `src/components/roadmap.tsx`, the same look with its own page frame.
- Motion is three springs in `src/motion.ts`, installed as CSS `linear()`
  easings (`.press`, `.pop-in`, `.settle-in`, `.draw-check`) and `useSpring`
  for numbers that roll. No animation library. Nothing loops except a running
  timer, and everything is off under reduced motion. No celebration bursts.
- Icons are hand-drawn inline SVG in `src/components/icons.tsx`, one stroke
  weight, `currentColor`. No icon font, no package. Platform glyphs never go
  inside a fixed-width slot that holds a name - that is how "Instagram" became
  "Insta...".
- No sounds beyond the Post till and the warm-up chime.

## The model

**A video is one deliverable, posted to every account.** Inflow's contract says
one piece of content on TikTok and Instagram is *one* deliverable, and he
confirmed the same for Vertus.

**The quota lives on the campaign; platforms are destinations.**
`campaigns.posts_per_week` is the only source of how much a week owes and what
it pays (week = deliverable value x posts per week; a day is a seventh, a
month 30/7 of a week). `daily_post_quota` is what the Post grid owes on a day
and is always `ceil(posts_per_week / 7)`, written together with it by the data
layer. (It used to be the only source, per day; the weekly rate replaced it at
his request, with existing campaigns migrated per-day x 7.) Nothing derives
either from the account list. This is not a detail: when
demand was read off the accounts, adding YouTube to a campaign owing one video
a day silently changed both the obligation and the earnings, and the screens
showed "$105/day" and "19 of 6 posted" as a result. Platforms say *where* a
deliverable goes, never *how many* there are.

**The Post screen is a grid, not a list of videos.** Rows are the campaign's
accounts, columns are the deliverables owed today (`src/data/posting.ts`).
Ticking a box records a `video_post`; ticking three platforms for the same
column records three destinations against the *same* video, so it is earned
once. A deliverable counts as posted the first time it goes out anywhere, and
stops counting only when its last destination is removed.

**He ticks every Post box himself.** Ticking is the moment he earns the money
on screen, and that is the point of the screen for him. The cutter bridge -
which ticked boxes when the silence cutter posted, painted Postiz-scheduled
posts as blue boxes, suggested cutter links and fed the views tracker - was
removed at his request: "Don't make it so when I post something on my cutter,
it changes it here, because it kind of ruins the whole fun and the whole
purpose of it. I want to check everything myself." Do not rebuild anything
that ticks, schedules or marks Post boxes without his tap. Making his own
ticking faster is welcome: each campaign has a "Check all" button
(`markAllOwed`) that ticks every open owed box through the same `markPosted`
a tap uses. `campaigns.cutter_campaign_id` and `min_views` stay in the schema;
the first is read by the Postiz channel list when archiving and by Analytics,
the second is a term of the deal shown on the campaign page.

**Views are read, never acted on.** Each campaign on Post has an Analytics
button (owner only) that reads the cutter's own per-post view readings through
`cutter-posted` and shows the month's views and each account's last 24 hours,
flagged under 100, 200 or 500 (`src/data/campaignViews.ts`,
`src/screens/CampaignAnalytics.tsx`). It writes nothing and ticks nothing.
The cutter is shared with Jake (one login, each posting through his own
Postiz key), so a cutter campaign holds both their posts: only accounts that
match one of his saved handles exactly, on the same platform, are counted
(`mineFor`) - never "the only account on that platform", which once put
Jake's posts on his accounts.

**Posting is never gated on filming.** He films on his phone, edits elsewhere
and posts things this app never saw. A tick with no video behind it creates
one. "Nothing ready to post" was the app telling him his own work did not
happen, and it must not come back in any form.

**One phase chain: `to_film → filmed → edited → posted`.** It used to branch on
`approval_mode` through `submitted` and `approved`, and nothing in the app
could move a video into either, so videos stopped dead after editing and the
ledger never moved. A brand's approval happens in SideShift and WhatsApp and
the app is never told about it, so it is not modelled as a phase. The
`video_phase` enum keeps all eight values - Postgres cannot drop one, and doing
it the long way rewrites the append-only history.

**Accounts, not handles.** Where a campaign posts is a row with a platform, a
handle, an email and a password, ready from the start (the old warm-up
`status` column stays in the schema and gates nothing). Handles were never
a claim about a document, so they were never really campaign fields - and a
login belongs to one account, not to a campaign: he runs a different account
per platform. Platforms are picked from a list (`KNOWN_PLATFORMS`), because
free text produced a real row called "Instagram & Youtube" that no handle
could describe. `campaign_accounts.posts_per_day` is legacy and unread.

**Angles are optional context, never something to maintain.** Nothing asks him
to create one, there is no angles UI, and hook generation works identically
with none, one or many. Where they exist they are extra context and a family
to rotate.

## Acceptance checks

Run these before declaring anything done.

- Marking a post is one tap. The box turns green and **stays in place**. Rows
  and boxes must never reorder or disappear under the user's thumb.
- A campaign owing one post a day across three platforms shows ONE campaign,
  THREE boxes, and pays rate x 1 - never rate x 3.
- Every box can be ticked with nothing filmed in the app, and the day's owed
  count can always be filled by hand.
- The posted count can never exceed what was actually posted: it counts
  deliverables with a post today, not phase changes.
- A video can get from `to_film` all the way to `posted`, and posting it
  snapshots the rate.
- Hook generation works with no angles, and builds from the campaign's
  "Product & hook ideas" box.
- A campaign typed in with only a name and its videos a day still saves, with
  everything else reading "not saved yet".
- A generated hook is never presented as one he wrote.
- Turn the network off: the app loads, every screen works, every write persists.
- Sign in: rows actually arrive on the server. Check by querying it, not by
  trusting the absence of an error.

## When you are stuck or the spec is silent

Stop and ask. Do not invent a rule, a rate, or a piece of campaign content to
fill a gap. Listing what you could not determine is a correct answer; guessing
is not.
