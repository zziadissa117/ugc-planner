# CLAUDE.md

Working agreements for this repository. Read this and `docs/SPEC.md` before
writing any code. Re-read both when you are unsure; do not work from memory of
an earlier session.

## What this is

A UGC content production planner for a single creator who runs several brand
campaigns at once. He has a day job and works in a window after it.

The app's job is to **give him a target and a scoreboard**. He picks the
campaign, says how many videos, and the app puts everything he needs on one
screen and counts them off. There is no timer anywhere on this path, and no
separate EDIT session either - see the note on both below.

> This used to read "the app's job is to remove the deciding", and the app was
> built that way: it chose the campaign, chose the count, and packed his
> window. He said plainly that he wanted the opposite - "i need list of hooks,
> things i can say and cant say, quick summary of the campaign, and a time so i
> can track and a goal x number of videos". The old behaviour survived for a
> while as "Or plan it for me", one button off the main path, and has since
> been removed entirely - see below.
>
> The FILM console built from that quote still asked "how long tonight?"
> before it asked for a goal, and a near-identical EDIT console asked the same
> pair of questions again for a stage that only ever needed his own editing
> style. He later cut both: "remove the how long tonight and put volume only
> after i click on film. the others dont need a timer for anything or volume
> of production." So FILM asks only for a goal, nothing anywhere shows an
> elapsed clock, and EDIT is not a session at all - a filmed video becomes a
> single "Mark edited" button on the home screen (`EditBacklog` in
> `src/screens/Now.tsx`) that advances the oldest one, no goal or campaign
> picker involved.
>
> "Or plan it for me" is gone too, and with it the whole fitting algorithm,
> the SHOOT teleprompter and the separate tick-off list: "Remove the Plan
> feature completely. I don't understand the workflow and it does not make
> sense for how I work." Do not rebuild a planner. `src/fitting`,
> `src/session`, `src/chatgpt.ts`, `VideoRow`, `Shoot` and `TickOff` were
> deleted outright rather than left dark.

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

## Look and motion

He chose the **instrument** language for every screen: the Post screen's
network view carried everywhere. A pitch-black ground, hairline rules and
spacing instead of boxed cards, big tabular numbers as each screen's headline,
a small dot for a row's state. A bordered card is used only where the whole
block is one tap (FILM, POST, a tick box) or a control needs a visible edge to
be found (the rate on the brief page). He turned down frosted, layered cards.

- Build from `src/components/ui.tsx` (section labels, buttons, disclosures,
  action tiles, state dots) and `styles.ts` (button and input classes, the
  `Tone` type). Do not re-type long class strings per screen.
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
`campaigns.daily_post_quota` is the only source of how much a day owes, and
`pay_per_video_cents x daily_post_quota` is the only source of what a day
pays. Nothing derives either from the account list. This is not a detail: when
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
handle, an email, a password and a warm-up status he sets. Handles were never
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
- Hook generation works with no angles, and builds from what he dumped into
  the brief's Hooks & ideas box.
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
