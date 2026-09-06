# UGC Planner deployment handoff

The app is Netlify-ready: `netlify.toml` builds with `npm run build` and
publishes `dist`. Deploy the repository root; do not deploy this folder by
itself.

## Before deploying

1. In Supabase SQL Editor, apply the migrations in numerical order. Existing
   production is empty, so `0004`, `0005`, `0006`, and `0008` can be run as a
   batch. Do **not** run `0007` yet: the shipped UI still reads the legacy
   quota while the account editor is being completed.
2. In Netlify, set `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and
   `VITE_PARSE_CAMPAIGN_DEPLOYED=true` for all deploy contexts.
3. Deploy from the repository root. Netlify will run the defined build and
   publish `dist`.

## What this handoff adds

- Account, hook, and work-session schema plus an IndexedDB v4 upgrade that
  preserves existing device data and derives editable account rows.
- A background signed-in sync loop, so the existing outbox is now drained.
- Explicit pull-cursor mapping and missing mutable-table timestamps, fixing
  the first-sync failure caused by blindly querying `updated_at`.

## Verification

Run `npm run build` and `npm test` before deployment. Build output is expected
to include a Vite chunk-size advisory; it does not block deployment.
