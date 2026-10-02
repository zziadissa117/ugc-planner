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
5. **`phase_events` and `warmup_events` are append-only.** Counts come from them at query time.
6. **Never invent campaign data** (rates, quotas, handles, URLs, hooks, rules). Missing -> "not saved yet". Parsed fields are amber until confirmed. Generated text names its model.
7. **`docs/schema.sql` is authoritative.** Change it, add `docs/migrations/00NN_*.sql` (re-runnable), run `npm run generate:types`. **Show the migration to the owner and wait for OK before applying it to Supabase.**
8. **AI keys never reach the browser.** Model calls go through Supabase Edge Functions in `supabase/functions/`. Files in `_shared/` other than `claude.ts` are generated; edit the `src/` source and run `npm run vendor`.
9. **UI:** colour carries state only (green posted, white now, grey later, amber unconfirmed/overdue, red blocked). Use `src/components/ui.tsx` and `styles.ts`. Inline SVG icons only.
10. **Posting is never gated on filming.** One video = one deliverable posted to many accounts; quota lives on `campaigns.daily_post_quota`.

## Where things are

- Data layer: `src/data` (`DataAdapter.ts`, `local/LocalAdapter.ts`, `local/db.ts`, generated `schema.ts`)
- Sync: `src/sync` (engine, supabaseTarget, auth)
- Money maths: `src/money.ts`
- Screens: `src/screens/*.tsx` (tests beside them); routes in `src/main.tsx`
- AI: `src/parser/` + `supabase/functions/parse-campaign`; `src/hooks/` + `supabase/functions/generate-hooks`
- Schema + migrations: `docs/schema.sql`, `docs/migrations/`

## Workflow

Work in phases, verify each (tests, typecheck, lint, no console errors), commit
after each phase with a descriptive message. Keep changes minimal and match
surrounding style. If the spec is silent, stop and ask rather than guess.
