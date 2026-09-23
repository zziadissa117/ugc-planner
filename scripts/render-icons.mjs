// Renders the PNG icons from the SVGs in public/.
//
// iOS will not use an SVG as a home-screen icon: pointed at one, a bookmark
// saved to the home screen falls back to a snapshot of the page. He uses this
// app from exactly such a bookmark, so the icon has to exist as a PNG - and a
// hand-exported PNG would drift from the SVG the first time either changed.
// This draws them from the SVGs with the Playwright browser the e2e suite
// already uses. Run it after changing either SVG: `node scripts/render-icons.mjs`.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public')

// iOS rounds the corners itself and wants a full square with no
// transparency, so the home-screen icon is drawn from the full-bleed
// maskable artwork, as are the install icons that may be masked.
// iOS only rounds the corners - it does not mask to a circle - so the
// home-screen icon can carry the mark larger than the maskable safe zone
// allows.
const OUTPUTS = [
  { svg: 'icon-maskable.svg', png: 'apple-touch-icon.png', size: 180, scale: 0.96 },
  { svg: 'icon.svg', png: 'icon-192.png', size: 192 },
  { svg: 'icon.svg', png: 'icon-512.png', size: 512 },
  { svg: 'icon-maskable.svg', png: 'icon-maskable-512.png', size: 512 },
]

const browser = await chromium.launch()
for (const { svg, png, size, scale } of OUTPUTS) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  const source = readFileSync(resolve(PUBLIC, svg), 'utf8')
  const markup = scale === undefined ? source : source.replace('scale(0.8)', `scale(${scale})`)
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${markup.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
  )
  await page.screenshot({ path: resolve(PUBLIC, png), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
  await page.close()
  console.log(`wrote public/${png}`)
}
await browser.close()
