// A campaign's minimum views per video (campaigns.min_views), the way he says
// and types it: "1,000", "1.5K", "2M". A term of the deal, read on the brief.

/** "1,000", "1.2K", "15K", "1.5M" - a minimum as he'd say it. */
export function formatViews(views: number): string {
  if (views >= 1_000_000) return `${Number((views / 1_000_000).toFixed(1))}M`
  if (views >= 10_000) return `${Math.round(views / 1000)}K`
  return views.toLocaleString('en-US')
}

/** A typed minimum - "1000", "1,000", "1k", "1.5K", "2m" - or null for none
 *  or anything that isn't one. */
export function parseViews(raw: string): number | null {
  const lowered = raw.trim().toLowerCase().replace(/\s/g, '')
  // "1,5k" is one and a half thousand (a decimal comma); "1,500" is fifteen
  // hundred - the same rule as money (plainNumber in campaignFields.ts).
  const text = /^\d+,\d{1,2}[km]?$/.test(lowered) ? lowered.replace(',', '.') : lowered.replace(/,/g, '')
  const match = /^(\d+(?:\.\d+)?)([km])?$/.exec(text)
  if (!match) return null
  const n = Math.round(Number(match[1]) * (match[2] === 'm' ? 1_000_000 : match[2] === 'k' ? 1000 : 1))
  return Number.isSafeInteger(n) && n > 0 ? n : null
}
