// Editing a campaign field, with its provenance kept honest.
//
// Two things have to happen together when a field with an operational meaning
// changes: the field row (which carries the provenance) and the campaign
// column the app actually plans against. Writing one without the other is how
// a screen ends up showing a confirmed rate next to "not saved yet".
//
// COLUMN_FIELDS lives here rather than in the parser so the import flow and
// the campaign screen promote the same keys the same way.

import type { Campaign, CampaignField, DataAdapter } from './index'

/** Field keys that also set a column on the campaign row once they stop being
 *  unreviewed. Everything else is a field row and nothing more. */
export const COLUMN_FIELDS = {
  pay_per_video_cents: 'pay_per_video_cents',
  cycle_size: 'cycle_size',
} as const satisfies Record<string, keyof Campaign>

/** Field keys whose value is integer cents, and which therefore render and
 *  parse as money rather than as a bare number. */
export const MONEY_FIELDS: readonly string[] = ['pay_per_video_cents']

/** Dollars in, integer cents out - or null if it is not a plain amount.
 *
 *  Deliberately string arithmetic. `35.10 * 100` is 3510.0000000000005 in
 *  floating point, and CLAUDE.md's "money is integer cents, never floats"
 *  rule is not satisfied by rounding that afterwards and hoping. */
export function parseDollarsToCents(input: string): number | null {
  const trimmed = input.trim().replace(/^\$/, '').replace(/,/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null

  const [whole, fraction = ''] = trimmed.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : null
}

/** Integer cents in, a plain dollars string out - no symbol, for an input. */
export function centsToDollarsInput(cents: number): string {
  const whole = Math.floor(Math.abs(cents) / 100)
  const remainder = String(Math.abs(cents) % 100).padStart(2, '0')
  return `${cents < 0 ? '-' : ''}${whole}.${remainder}`
}

/** A whole, non-negative count, or null. Used for the columns that are counts
 *  rather than money. */
export function parseCount(input: string): number | null {
  const trimmed = input.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? value : null
}

function columnPatchFor(fieldKey: string, value: string | null): Partial<Campaign> | null {
  const column = COLUMN_FIELDS[fieldKey as keyof typeof COLUMN_FIELDS]
  if (!column) return null

  if (value === null) return { [column]: null } as Partial<Campaign>

  const parsed = parseCount(value)
  if (parsed === null) return null
  return { [column]: parsed } as Partial<Campaign>
}

/** His own value for a field, replacing whatever was there.
 *
 *  Always `user_entered`: a value he typed is his word for it, never a
 *  documented one, no matter what the parser had previously put in the row.
 *  A blank clears the field back to "not saved yet" rather than storing an
 *  empty string, so an unset field reads the same however it got that way. */
export async function saveFieldValue(
  adapter: DataAdapter,
  campaignId: string,
  fieldKey: string,
  value: string | null,
): Promise<CampaignField> {
  const cleaned = value === null || value.trim() === '' ? null : value.trim()

  const field = await adapter.setCampaignField({
    campaign_id: campaignId,
    field_key: fieldKey,
    field_value: cleaned,
    source: cleaned === null ? 'missing' : 'user_entered',
    // Typed by hand, so there is no document behind it and no quote to cite.
    source_quote: null,
    source_document_id: null,
  })

  const patch = columnPatchFor(fieldKey, cleaned)
  if (patch) await adapter.updateCampaign(campaignId, patch)

  return field
}

/** His tap on an unreviewed field. The adapter decides what it is promoted to
 *  - `documented` with a quote behind it, `user_entered` without - and the
 *  column follows only once it is no longer unreviewed. */
export async function confirmFieldValue(
  adapter: DataAdapter,
  campaignId: string,
  fieldKey: string,
): Promise<CampaignField> {
  const field = await adapter.confirmCampaignField(campaignId, fieldKey)

  const patch = columnPatchFor(fieldKey, field.field_value)
  if (patch) await adapter.updateCampaign(campaignId, patch)

  return field
}
