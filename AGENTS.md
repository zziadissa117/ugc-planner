# AGENTS.md

Instructions for coding agents (Codex, Claude Code) working in this repo.
Full map: `ARCHITECTURE.md`. Full rules: `CLAUDE.md` and `docs/SPEC.md` (read both
before writing code). Keep this file and `ARCHITECTURE.md` updated whenever a
change adds, moves or removes a file, table, env var or route.

## What it is

Local-first PWA that plans UGC video production for one creator running several
brand campaigns. Vite + React + TypeScript + Tailwind, Dexie (IndexedDB) store,
Supabase (Postgres/Auth/Edge Functions) sync, Netlify hosting.

## Commands

```
npm ci
npm run dev
npm test                 # must stay green (offline, ~35s)
npx tsc -b               # typecheck
npm run lint
npm run build            # also runs check:types and check:vendored
npm run generate:types   # after editing docs/schema.sql
npm run vendor           # after editing src/parser/{types,verify}.ts or src/hooks/hookPrompt.ts
```

## Hard rules

1. **Do not add dependencies** (no state lib, component lib, ORM, analytics).
2. **No component imports Dexie or `supabase-js`.** Use `useData()` (`DataAdapter`).
   No SupabaseAdapter; sync is row-level in `src/sync`.
3. **Local-first:** every write lands locally, returns immediately, and enqueues to `_outbox`. Nothing waits on the network.
4. **Money = integer cents.** No floats, no currency lib.
5. **`phase_events`, `warmup_events` and `earnings_events` are append-only.** Counts come from them at query time.
6. **Never invent campaign data** (rates, quotas, handles, URLs, hooks, rules). Missing -> "not saved yet". Parsed fields are amber until confirmed. Generated text names its model.
7. **`docs/schema.sql` is authoritative.** Change it, add `docs/migrations/00NN_*.sql` (re-runnable), run `npm run generate:types`. **Show the migration to the owner and wait for OK before applying it to Supabase.**
8. **AI keys never reach the browser.** Bring-your-own-key: each user's key is stored encrypted (Vault) and used only inside Edge Functions in `supabase/functions/`; the browser sees the last 4 characters only. Never add a project-wide model key, never put a key in Dexie/localStorage/outbox/export. Files in `_shared/` other than `claude.ts` are generated; edit the `src/` source and run `npm run vendor`.
9. **UI:** colour carries state only (green posted, white now, grey later, amber unconfirmed/overdue, red blocked). Use `src/components/ui.tsx` and `styles.ts`. Inline SVG icons only.
10. **Posting is never gated on filming.** One video = one deliverable posted to many accounts. Quota is `campaigns.posts_per_week` (edited, drives money); `daily_post_quota` = ceil(weekly/7) is what the Post grid owes - both written together by `LocalAdapter`, never separately.

## Where things are

- Data layer: `src/data` (`DataAdapter.ts`, `local/LocalAdapter.ts`, `local/db.ts`, generated `schema.ts`)
- Sync: `src/sync` (engine, supabaseTarget, auth)
- Money maths: `src/money.ts` (projected, weekly), `src/data/earnings.ts` (per-tick pay + history), `src/data/payouts.ts`
- Screens: `src/screens/*.tsx` (tests beside them); routes in `src/main.tsx`
- AI: `src/parser/` + `supabase/functions/parse-campaign`; `src/hooks/` + `supabase/functions/generate-hooks`; keys: `src/ai/`, `src/screens/AiKeys.tsx`, `supabase/functions/ai-key`
- The Supabase project is shared with the cutter/editor app (`cutter_*` tables/functions). Leave those alone.
- Archive: `archiveCampaign` / `restoreCampaign` / `listArchivedCampaigns` (`campaigns.archived_at`, migration 0018); Archived view `src/screens/ArchivedCampaigns.tsx` at `/campaigns/archived`. Restore reactivates the accounts changed at or after the archive. The old `deleteCampaign` stays as "Delete for good", only from that view.
- No seeding: the app no longer creates the Inflow campaign on first launch (it handed one person's private deal to every new user and shipped it in the bundle). `src/data/seed/` is imported by tests only; keep it out of app code.
- Cutter bridge: `docs/CUTTER_BRIDGE.md` (migration 0017, `supabase/functions/cutter-posted`, `src/sync/cutterBridge.ts`).
- Schema + migrations: `docs/schema.sql`, `docs/migrations/`

## Workflow

Work in phases, verify each (tests, typecheck, lint, no console errors), commit
after each phase with a descriptive message. Keep changes minimal and match
surrounding style. If the spec is silent, stop and ask rather than guess.
