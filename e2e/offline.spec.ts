// Phase 10 acceptance check (CLAUDE.md): "Turn the network off: the app
// loads, every screen works, every write persists."
//
// Runs against a real production build served over HTTP (see
// playwright.config.ts) - the service worker vite-plugin-pwa generates only
// exists in `dist`, not in the dev server's output, so this is the only way
// to actually prove offline behaviour rather than assume it from the config.

import { expect, test } from '@playwright/test'

/** The first load registers the service worker but is not controlled by it.
 *  A second navigation is needed before requests are actually served from the
 *  precache - skipping this step would make the offline reload below succeed
 *  for the wrong reason (a bfcache hit) rather than the one being tested. */
async function warmServiceWorker(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true))
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 15_000,
  })
}

test.describe('offline (Phase 10 acceptance check)', () => {
  test('the app loads with the network off', async ({ page, context }) => {
    await warmServiceWorker(page)

    await context.setOffline(true)
    await page.reload()

    // The NOW screen's header renders a live clock and the day's tally - both
    // require the local store to have actually opened, not just a blank shell.
    await expect(page.getByText(/posted$/)).toBeVisible()
  })

  test('every screen still renders with the network off', async ({ page, context }) => {
    await warmServiceWorker(page)
    await context.setOffline(true)
    await page.reload()

    const screens: Array<[string, string | RegExp]> = [
      ['/tick-off', 'Tick them off'],
      ['/campaigns', 'Briefs'],
      ['/campaigns/new', 'New campaign'],
      ['/money', 'Money'],
      ['/settings', 'Setup'],
    ]

    for (const [path, heading] of screens) {
      await page.goto(path)
      await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    }
  })

  test('a write made offline persists across an offline reload', async ({ page, context }) => {
    await warmServiceWorker(page)
    await context.setOffline(true)

    const campaignName = `Offline E2E ${Date.now()}`

    await page.goto('/campaigns/new')
    await page
      .getByLabel('Parsed JSON')
      .fill(JSON.stringify({ campaign: { name: campaignName, company: null, approval_mode: null } }))
    await page.getByRole('button', { name: 'Review it' }).click()
    await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible()

    // No document ever states a handle - Save stays disabled without one, so
    // this fills the one thing the paste-JSON path never provides.
    await page.getByLabel('TikTok @').fill('@offline-e2e')

    // No network round trip to wait on - the write is local-first and the
    // screen navigates as soon as it lands.
    await page.getByRole('button', { name: 'Save campaign' }).click()
    await expect(page.getByRole('heading', { name: campaignName })).toBeVisible()

    // Reload while still offline - a campaign held only in React state would
    // vanish here. Finding it again proves it reached IndexedDB.
    await page.reload()
    await expect(page.getByRole('heading', { name: campaignName })).toBeVisible()

    await page.goto('/campaigns')
    await expect(page.getByText(campaignName)).toBeVisible()
  })
})
