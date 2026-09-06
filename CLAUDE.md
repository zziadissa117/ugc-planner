# CLAUDE.md

Working agreements for this repository. Read this and `docs/SPEC.md` before
writing any code. Re-read both when you are unsure; do not work from memory of
an earlier session.

## What this is

A UGC content production planner for a single creator who runs several brand
campaigns at once. He has a day job and works in a window after it.

The app's job is to **give him a target and a scoreboard**. He picks the
campaign, says how many videos and how long he has, and the app puts everything
he needs on one screen and counts them off.

> This used to read "the app's job is to remove the deciding", and the app was
> built that way: it chose the campaign, chose the count, and packed his
> window. He said plainly that he wanted the opposite - "i need list of hooks,
> things i can say and cant say, quick summary of the campaign, and a time so i
> can track and a goal x number of videos". The old behaviour is still there as
> "Or plan it for me", one button, off the main path. Do not restore it as the
> default.

He works **on a laptop with the phone as the camera**. That is why the session
console shows everything at once rather than one video at a time: he is reading
a laptop screen across the room, not a phone propped against a mug.

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

**History is append-only.** `phase_events` is inserted into and read from,
never updated or deleted. Anything countable is counted from it at query time -
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

**Colour carries state only.** green = posted, bright white = do this now,
grey = later, amber = past the window you set or an unconfirmed parsed field,
red = blocked with the reason in plain words. No decorative colour, no badges
for anything that is not a state.

## The model

**A video is one deliverable, posted to every account.** Inflow's contract says
one piece of content on TikTok and Instagram is *one* deliverable, and he
confirmed the same for Vertus. So a campaign's daily demand is the **maximum**
of `posts_per_day` across its ready accounts, never the sum, and the posting
checklist marks a video posted when the **last** account is ticked.

**One phase chain: `to_film → filmed → edited → posted`.** It used to branch on
`approval_mode` through `submitted` and `approved`, and nothing in the app
could move a video into either, so videos stopped dead after editing and the
ledger never moved. A brand's approval happens in SideShift and WhatsApp and
the app is never told about it, so it is not modelled as a phase. The
`video_phase` enum keeps all eight values - Postgres cannot drop one, and doing
it the long way rewrites the append-only history.

**Accounts, not handles.** Where a campaign posts is a row with a platform, a
handle, a posts-per-day and a warm-up status he sets. Handles were never a
claim about a document, so they were never really campaign fields.

## Acceptance checks

Run these before declaring anything done.

- Marking a video posted is one tap. The row turns green and **stays in place**.
  Rows must never reorder or disappear under the user's thumb.
- A FILM session never proposes editing, and is timed in film minutes only.
- A video can get from `to_film` all the way to `posted`, and posting it
  snapshots the rate.
- Runway (days of posts banked) counts edited stock and drops by one per post.
- Base earned is never summed with anything else.
- A campaign created from a contract with no brief still saves, with the
  brief-derived fields blank.
- Every parsed field renders amber until confirmed.
- A generated hook is never presented as one he wrote.
- Turn the network off: the app loads, every screen works, every write persists.
- Sign in: rows actually arrive on the server. Check by querying it, not by
  trusting the absence of an error.

## When you are stuck or the spec is silent

Stop and ask. Do not invent a rule, a rate, or a piece of campaign content to
fill a gap. Listing what you could not determine is a correct answer; guessing
is not.
