# CLAUDE.md

Working agreements for this repository. Read this and `docs/SPEC.md` before
writing any code. Re-read both when you are unsure; do not work from memory of
an earlier session.

## What this is

A UGC content production planner for a single creator who runs several brand
campaigns at once. He has a day job and works in a window after it. The app's
job is to **remove the deciding**: he says what kind of session it is and how
long he has, and it tells him exactly what to make and in what order.

## Stack - locked, do not substitute

- Vite + React + TypeScript
- Tailwind for styling
- `vite-plugin-pwa` for installability and offline
- Dexie (IndexedDB) for the local store
- Supabase (Postgres + Auth) for sync - **not yet provisioned**
- Netlify for hosting - live at https://ugc-planner.netlify.app, see
  `docs/DEPLOY.md`

Do not add a state management library, a component library, an ORM, or an
analytics dependency. If you think one is needed, say so and stop.

## Supabase is not live yet

There is no project to connect to. Build against the local adapter.

- `docs/schema.sql` is the authoritative shape. Mirror it exactly in the local
  store: same table names, same column names, same enums, same constraints
  enforced in code where IndexedDB cannot enforce them.
- All persistence goes through a `DataAdapter` interface. Ship `LocalAdapter`
  now.
- **Superseded:** a `SupabaseAdapter` implementing the same interface was
  planned here and is no longer wanted. Sync pushes *rows*; `DataAdapter` is
  an interface of *intents* (`advanceVideoPhase`, `confirmCampaignField`), and
  implementing those against Postgres would put the phase chain, the rate
  snapshot rule and the provenance rules on the server as a second copy free
  to drift from `src/data`. The remote side is `SyncTarget` in `src/sync`,
  which is row-level on purpose. Online-only mode is out of scope. See
  `docs/SYNC.md`.
- No component imports Dexie or `supabase-js` directly. Ever.

## Non-negotiables

**Local-first.** Every write lands locally and returns immediately, then syncs
in the background through an outbox queue. No user action ever waits on a
network round trip. He taps "posted" on a phone with bad signal, in a hurry. If
that tap spins, the app is broken.

**Money is integer cents.** Never floats. Never a currency library.

**History is append-only.** `phase_events` is inserted into and read from,
never updated or deleted. Measured timings are derived from that log at query
time, never stored as a mutable number.

**Never invent campaign data.** No pay rate, quota, handle, submission URL,
angle, hook or rule may be written unless it came from the user or from an
uploaded document. Missing values render "not saved yet". A plausible guess is
worse than a blank.

**Colour carries state only.** green = posted, bright white = do this now,
grey = later, amber = waiting on someone else or an unconfirmed parsed field,
red = blocked with the reason in plain words. No decorative colour, no badges
for anything that is not a state.

## Build order

Commit after each phase. Do not start a phase before the one above it passes
its checks.

1. **Scaffold** - Vite, TS, Tailwind, PWA, routing. Dark theme, large tap
   targets, no hover-only interactions.
2. **Data layer** - types generated from `docs/schema.sql`, `DataAdapter`
   interface, `LocalAdapter` over Dexie, export/import of all state as JSON.
3. **Campaign seed** - load the Inflow campaign from `docs/SPEC.md` section 9.
   Every field carries its `source`. Nothing marked `documented` without a
   quote from the real document.
4. **NOW screen** - session type, time window, the video list, one-tap phase
   advance, the tick-off list.
5. **Fitting algorithm** - the weights object, session-scoped packing, setup
   batching.
6. **SHOOT screen** - script paste box, teleprompter display.
7. **Money** - three separate figures, accrued vs payable, opening balance.
8. **Campaign drop box** - file input, review screen. Parser calls a Supabase
   Edge Function that does not exist yet; stub it behind an interface and make
   the paste-JSON path work now.
9. **Sync** - `SupabaseAdapter`, auth, outbox, conflict handling.
10. **Deploy** - Netlify, PWA install, offline verification.

## Acceptance checks

Run these before declaring any phase done.

- Marking a video posted is one tap. The row turns green and **stays in place**.
  Rows must never reorder or disappear under the user's thumb.
- A FILM session never proposes editing, and is timed in film minutes only.
- Runway (days of posts banked) drops by one per post and rises when a video
  reaches `approved`.
- Base earned, expected bonus and paid bonus are never summed into one figure
  anywhere in the UI.
- A campaign created from a contract with no brief still saves, with the
  brief-derived fields blank.
- Every parsed field renders amber until confirmed.
- Turn the network off: the app loads, every screen works, every write persists.
- Freshly reset, the ledger is empty except the user-entered opening balance.

## When you are stuck or the spec is silent

Stop and ask. Do not invent a rule, a rate, or a piece of campaign content to
fill a gap. Listing what you could not determine is a correct answer; guessing
is not.