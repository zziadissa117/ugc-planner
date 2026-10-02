# ARCHITECTURE

Map of the repo. Rules and product intent live in `CLAUDE.md` and `docs/SPEC.md`;
this file says where things are. Keep it current: any change that moves, adds
or removes a file, table, env var or route updates this file and `AGENTS.md`.

## Stack

Vite 8 + React 19 + TypeScript 6, Tailwind 4, `react-router-dom` 7 (browser
router), `vite-plugin-pwa` (offline), Dexie 4 (IndexedDB) as the local store,
Supabase (Postgres + Auth + Edge Functions) for sync and server-side AI,
Netlify for hosting (`netlify.toml`, SPA redirect). Tests: Vitest + Testing
Library + `fake-indexeddb`; Playwright for the offline e2e. Lint: oxlint.
No state library, no component library, no ORM (locked in `CLAUDE.md`).

Single user, local-first: every write lands in Dexie and returns at once, then
a background outbox drains rows to Supabase.

## Data flow

```
screens (src/screens)  ->  useData() / DataAdapter intents  ->  LocalAdapter (Dexie)
                                                                    |  every write also enqueues
                                                                    v
                                                               _outbox table
                                                                    |  drainOutbox / pullChanges (src/sync/engine.ts)
                                                                    v
                                              SupabaseSyncTarget (row-level upsert) -> Postgres + RLS
```

- Components never import Dexie or `supabase-js`. They get a `DataAdapter` from
  `useData()` (`src/data/useData.ts`, provided by `DataProvider.tsx`).
- `DataAdapter` (`src/data/DataAdapter.ts`) is an interface of *intents*
  (`advanceVideoPhase`, `markVideoPosted`, `confirmCampaignField`...).
  `LocalAdapter` implements it; there is deliberately **no SupabaseAdapter**.
  Remote is `SyncTarget` in `src/sync`, which pushes rows.
- Business rules (phase chain, rate snapshot, provenance) live in `src/data`
  (`constraints.ts`, `phases.ts`, `posting.ts`, `LocalAdapter.ts`), never on the server.

## Where AI calls happen

All model calls go through **Supabase Edge Functions** (Deno), so the API key
never reaches the browser. **Bring-your-own-key:** there is no project-wide
model key. Each call decrypts the *signed-in user's* key from Supabase Vault
(`loadUserKey` in `supabase/functions/_shared/claude.ts`) for that one request.
Keys live in `public.user_ai_keys` (pointer + last 4 only; migration
`docs/migrations/0015_ai_keys.sql`), a **server-only** table: not in
`schema.sql`, not in Dexie, not synced or exported. The browser can read only
`provider/key_last4/updated_at`; writes go through the `ai-key` function.

| Feature | Client | Edge Function |
|---|---|---|
| Brief + contract organizer (parser) | `src/parser/edgeFunction.ts` (`EdgeFunctionParser`), fallback `src/parser/pastedJson.ts` | `supabase/functions/parse-campaign/index.ts` |
| Hook generation | `src/hooks/generateHooks.ts` | `supabase/functions/generate-hooks/index.ts` |
| Key management (save/status/remove) | `src/ai/keys.ts`, UI `src/screens/AiKeys.tsx` (in Setup) | `supabase/functions/ai-key/index.ts` |

Failures are `{ error, code }` with `code` in `no_key | invalid_key |
rate_limited | model_error` (HTTP 412 / 422 / 429 / 502); `src/ai/errors.ts`
turns them into plain sentences for both clients.

Both functions: require a signed-in session, call Anthropic Messages API with a
JSON-schema `output_config.format`, and **write nothing to the DB**. The client
applies results. Parser output passes `verifyQuotes` (`src/parser/verify.ts`)
on server and client. Contracts: `docs/EDGE_FUNCTION.md`. The client only
offers these when `VITE_PARSE_CAMPAIGN_DEPLOYED` / `VITE_GENERATE_HOOKS_DEPLOYED`
are `"true"`.

`supabase/functions/_shared/{verify,parserTypes,hookPrompt}.ts` are **generated
copies** of `src/parser/{verify,types}.ts` and `src/hooks/hookPrompt.ts`
(`npm run vendor`; `npm run build` fails if stale). Edit the `src/` file, then vendor.
`_shared/claude.ts` is hand-written, server-only.

## Folder map

```
CLAUDE.md, AGENTS.md, ARCHITECTURE.md   rules / map
docs/
  SPEC.md                  product spec (read with CLAUDE.md)
  schema.sql               AUTHORITATIVE DB shape (= migration 0001)
  migrations/00NN_*.sql    deltas for an already-provisioned project; README lists what is applied
  SYNC.md, DEPLOY.md, EDGE_FUNCTION.md, BRIEF_PROMPT.md, rls-check.sql
scripts/
  generate-types.mjs       schema.sql -> src/data/schema.ts (`check:types` fails build on drift)
  vendor-shared.mjs        src/ -> supabase/functions/_shared (`check:vendored`)
  render-icons.mjs         PWA icons
supabase/functions/        Edge Functions (see above)
e2e/                       Playwright: offline.spec.ts, sound.spec.ts
src/
  main.tsx                 router + providers + service worker registration
  App.tsx                  shell: 5-tab bottom nav, seed-on-boot
  money.ts                 earnings maths (integer cents; rate x quota; per-platform flag)
  motion.ts, sound.ts, warmupTimer(s).ts(x)   springs, till/chime sounds, warm-up countdowns
  components/              ui.tsx (labels/buttons/disclosures), styles.ts, icons.tsx (inline SVG),
                           AccountsEditor, EditableField, DocumentInput, platforms.ts
  data/                    the data layer (see below)
  sync/                    auth + outbox engine + SupabaseSyncTarget + conflict + claim
  ai/                      BYOK client: keys.ts (ai-key wrapper), errors.ts (error codes -> messages)
  parser/                  brief/contract parsing: types, verify, apply, edgeFunction, pastedJson
  hooks/                   hook generation client + hookPrompt (vendored to the function)
  screens/                 one file per route (+ .test.tsx beside each)
  test/setup.ts            vitest setup
```

### `src/data`

| File | Role |
|---|---|
| `schema.ts` | GENERATED types/enums for every table. Never hand-edit. |
| `DataAdapter.ts` | the interface (all intents) + `New*` input types |
| `local/db.ts` | Dexie schema, `version(n)` upgrades, `MIRRORED_TABLES`, `_outbox` |
| `local/LocalAdapter.ts` | implements everything; enqueues on every write |
| `constraints.ts` | SQL check constraints re-enforced in code (IndexedDB can't) |
| `sync.ts` | `PULL_CURSOR_COLUMN` per table |
| `phases.ts` | chain `to_film -> filmed -> edited -> posted` |
| `posting.ts` | Post-screen grid logic (deliverables x accounts, ticks, one video earned once) |
| `today.ts`, `streak.ts`, `workClock.ts` | day boundaries, counts, work-window helpers |
| `warmup.ts`, `accounts.ts` | account warm-up status / platform helpers |
| `campaignFields.ts`, `briefSections.ts` | parsed-field provenance, brief page sections |
| `seed/` | first-run seed (Inflow etc.) via `ensureSeeded` |

### Screens / routes (`src/main.tsx`)

`/` Now · `/post` Posting (the grid) · `/campaigns` list · `/campaigns/new`
drop box · `/campaigns/:id` brief · `/campaigns/:id/update` · `/money` ·
`/settings` (export/import, sign-in, studio todos). FILM console is `Console.tsx`,
launched from Now.

## Data model

Tables (see `docs/schema.sql`): `campaigns`, `campaign_accounts`,
`campaign_documents`, `campaign_fields`, `campaign_angles`, `campaign_hooks`,
`campaign_rules`, `videos`, `video_posts`, `phase_events` (append-only),
`work_sessions`, `warmup_events` (append-only), `bonus_tiers`, `bonus_claims`,
`time_estimates` (unused), `user_settings`. Local-only: `_outbox`.
Every table has `user_id` + RLS `user_id = auth.uid()`.

Key facts: money is integer cents; a video is one deliverable posted to many
accounts (`video_posts`); quota lives on `campaigns.daily_post_quota`;
`campaigns.pays_per_platform` is the only per-platform pay mechanism today;
`videos.rate_snapshot_cents` freezes the rate at post time.

Adding a table touches, in order: `docs/schema.sql` -> migration file ->
`npm run generate:types` -> `local/db.ts` (new `version(n)`, `MIRRORED_TABLES`) ->
`constraints.ts` -> `DataAdapter.ts` -> `LocalAdapter.ts` (+ outbox enqueue,
`backfillOutbox`, export/import/reset) -> `src/data/sync.ts` ->
`src/sync/{supabaseTarget,conflict}.ts` -> `schema.sql.test.ts` -> upgrade test.
(`CLAUDE.md` says this list is in `docs/migrations/README.md`; it isn't. This is it.)

## Env vars (names only)

Client (Vite, baked at build; none are secrets): `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_PARSE_CAMPAIGN_DEPLOYED`,
`VITE_GENERATE_HOOKS_DEPLOYED`. Template: `.env.example`. Netlify must have them
with scope "all" (see `docs/DEPLOY.md`).
Edge Function env (server only): `PARSE_CAMPAIGN_MODEL`, `GENERATE_HOOKS_MODEL`
(optional); `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are
injected by Supabase. `ANTHROPIC_API_KEY` is **no longer used** (per-user keys).
Playwright: `PLAYWRIGHT_BASE_URL`. Live tests need real-project credentials (see `*.live.test.ts`).

## Run, build, test

```
npm ci
npm run dev                # vite dev server (works offline with no .env; sync just stays off)
npm test                   # vitest, offline (617 tests at time of writing)
npx tsc -b                 # typecheck
npm run lint               # oxlint (existing warnings only)
npm run build              # check:types + check:vendored + tsc -b + vite build
npm run test:e2e           # Playwright offline spec against a preview build
npm run test:live          # hits the real Supabase project; deliberate only
```

Supabase project ref: `uykuoibqdxmpbbrsmyad`. **It is shared with the cutter/editor app** (`cutter_*` tables, `cutter` and `postiz` Edge Functions, `cutter_*` migrations that are not in this repo): never touch those, and expect `list_migrations` to show entries this repo does not have. Migrations are applied by hand /
via Supabase tooling, never automatically; a schema change needs the owner's OK.

## Conventions and gotchas

- `schema.sql` first, then types are regenerated; the build fails on drift.
- Migrations must be re-runnable (`drop policy if exists` before `create policy`).
- Every write must enqueue to `_outbox`; rows written in a Dexie `upgrade()` bypass it, so use `backfillOutbox`.
- `phase_events` / `warmup_events` are never updated or deleted.
- Never invent campaign data; missing renders "not saved yet". Parsed fields are amber until confirmed.
- Generated text must say it was generated (`campaign_hooks.source`, `model`).
- Colour is state only; build UI from `components/ui.tsx` + `styles.ts`; no new dependencies.
- Posting is never gated on filming; ticks never reorder.
- `pays_per_platform` is a flag he sets; nothing derives pay from the account list.
- `posts_per_day` on accounts, `time_estimates`, `src/data/seed` angles, and the retired `video_phase` values exist but are legacy.
