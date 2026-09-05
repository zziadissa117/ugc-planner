# Deploy - Phase 10

Live at **https://ugc-planner.netlify.app**. Netlify site `ugc-planner`
(id `02dcbc49-d87c-4d36-ad8a-2190d23740c0`), team `ugcacc1ziad`.

## What's configured

- `netlify.toml` - build command `npm run build`, publishes `dist`, and a
  `/* -> /index.html` SPA redirect. `createBrowserRouter` (`src/main.tsx`)
  needs this: without it, a hard refresh or a shared link on any route but
  `/` 404s at the CDN before React Router ever loads.
- Three env vars set on the Netlify project (Site configuration →
  Environment variables), matching `.env`: `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_PARSE_CAMPAIGN_DEPLOYED=true`. All
  three are baked into the client bundle at build time, same as locally -
  none of them are secrets (the publishable key is the anon key; RLS is what
  actually protects data, per `src/sync/auth.ts`).

  **Gotcha hit once already:** setting these with scope `["builds"]` did not
  persist - a read-back immediately after showed an empty env var list, and
  the resulting deploy shipped with no Supabase config at all (confirmed by
  grepping the built bundle for the project ref - zero matches). Re-set with
  scope `["all"]`, confirmed present via a read-back, then redeployed and
  confirmed the ref appears in the new bundle before trusting it. If a future
  env var change ever seems to have no effect, read it back before assuming
  it applied, and grep the deployed bundle for a value that should be in it.
- **Production visibility had to be set to Public.** The team's default
  project visibility is Private, which 401'd every request until changed
  under Site configuration → Visitor access → Project visibility →
  Production visibility. Deploy Preview visibility is left Private - that
  only gates preview/branch deploys, not the live URL.

## Verified

- SPA redirect, `manifest.webmanifest`, `sw.js` and `registerSW.js` all
  confirmed served correctly on the real deployed URL (not just the local
  build).
- `e2e/offline.spec.ts` (Playwright) passes against the real deployment:
  `PLAYWRIGHT_BASE_URL=https://ugc-planner.netlify.app npm run test:e2e`.
  Setting `PLAYWRIGHT_BASE_URL` skips the local `vite preview` webServer
  entirely (see `playwright.config.ts`) so a run against a remote URL cannot
  silently fall back to testing `localhost` instead - which is exactly what
  happened on the first attempt here before that guard existed.
- Proves the CLAUDE.md acceptance check verbatim against production: network
  off, the app loads, every screen renders, and a campaign created through
  the paste-JSON path survives a reload while still offline.

## Not yet done

- **PWA install** has not been verified on a real phone (Playwright can
  prove the manifest and service worker are correct, but "does the browser
  actually offer to install it" needs a real device). Open the site on the
  phone that will actually use it, and use the browser's "Add to Home
  Screen" / install prompt.
- No custom domain. `ugc-planner.netlify.app` is the permanent URL unless one
  is added later.
- Every push to `main` will redeploy automatically once Netlify's GitHub
  integration is connected - this deploy was pushed directly from the local
  working tree via the Netlify CLI (`npx @netlify/mcp`), not through a
  connected repo, so future commits do not yet auto-deploy. Connect the repo
  under Site configuration → Build & deploy if that's wanted.
