import { expect, test } from '@playwright/test'

// "why when i click on my post buttons for my $ sound it plays only sometimes,
// like sometimes i gotta refresh the page or close it all for it to play"
//
// Hooks AudioContext so the test can reach the instance the app made, force it
// into the states a browser really puts it in - suspended when a tab is
// backgrounded, interrupted on iOS after a call or a lock - and then tap a
// post box and check that something actually sounds, in a context that is
// running by the time it does.

declare global {
  interface Window {
    __ctxs: AudioContext[]
    __plays: string[]
  }
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__ctxs = []
    window.__plays = []
    const Real = window.AudioContext
    // @ts-expect-error - test double
    window.AudioContext = class extends Real {
      constructor(...args: unknown[]) {
        // @ts-expect-error - passthrough
        super(...args)
        window.__ctxs.push(this as unknown as AudioContext)
      }
      createBufferSource() {
        const node = super.createBufferSource()
        const start = node.start.bind(node)
        node.start = (...a: unknown[]) => {
          const self = this as unknown as AudioContext
          if (node.buffer && node.buffer.duration > 0.3) {
            window.__plays.push(self.state)
          }
          return start(...(a as []))
        }
        return node
      }
    }
  })
})

const plays = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.__plays)

test('no context is built before he taps anything', async ({ page }) => {
  // One made at mount is born suspended and cannot be resumed from outside a
  // gesture, which is what made the first tap a coin toss.
  await page.goto('/post')
  await page.waitForTimeout(900)

  expect(await page.evaluate(() => window.__ctxs.length)).toBe(0)
})

test('the first tap sounds, in a running context', async ({ page }) => {
  await page.goto('/post')
  await page.waitForTimeout(900)

  await page.getByLabel('TikTok post 1 of 1').click()
  await expect.poll(() => plays(page)).toHaveLength(1)
  expect((await plays(page))[0]).toBe('running')
})

test('a tap still sounds after the context was suspended', async ({ page }) => {
  // What happens to him: the tab goes to the background, the browser suspends
  // the context, and the next tap used to schedule into a context whose clock
  // was not moving.
  await page.goto('/post')
  await page.waitForTimeout(900)
  await page.getByLabel('TikTok post 1 of 1').click()
  await expect.poll(() => plays(page)).toHaveLength(1)

  await page.evaluate(async () => {
    for (const c of window.__ctxs) await c.suspend()
  })
  expect(await page.evaluate(() => window.__ctxs[0].state)).toBe('suspended')

  await page.getByLabel('TikTok extra post').click()
  await expect.poll(() => plays(page)).toHaveLength(2)
  // The second one must have gone out with the context awake.
  expect((await plays(page))[1]).toBe('running')
})

test('it comes back when the page returns to the front', async ({ page }) => {
  await page.goto('/post')
  await page.waitForTimeout(900)
  await page.getByLabel('TikTok post 1 of 1').click()
  await expect.poll(() => plays(page)).toHaveLength(1)

  // Backgrounded, suspended, then brought back - without a tap in between.
  await page.evaluate(async () => {
    for (const c of window.__ctxs) await c.suspend()
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(400)

  expect(await page.evaluate(() => window.__ctxs[0].state)).toBe('running')
})
