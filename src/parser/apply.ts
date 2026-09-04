// Turning a reviewed parse into campaign rows.
//
// Nothing here decides what is true. Every value arrives already carrying its
// provenance, and the only judgement this makes is the one the review screen
// recorded: which fields he tapped to confirm.

import type { Campaign, DataAdapter } from '../data'
import type { ParseResult } from './types'

/** Field keys that also set an operational column on the campaign row, once
 *  confirmed. Unconfirmed, the column stays null and the field stays amber -
 *  nothing counts as a documented rate or a verified cycle until he has
 *  checked it against the document himself. */
const COLUMN_FIELDS = {
  pay_per_video_cents: 'pay_per_video_cents',
  cycle_size: 'cycle_size',
} as const satisfies Record<string, keyof Campaign>

export interface ApplyInput {
  result: ParseResult
  /** Field keys he tapped to confirm on the review screen. */
  confirmed: ReadonlySet<string>
  briefText: string | null
  briefFilename: string | null
  contractText: string | null
  contractFilename: string | null
}

export async function applyParseResult(
  adapter: DataAdapter,
  input: ApplyInput,
): Promise<Campaign> {
  const { result, confirmed } = input

  // The campaign starts with no rate and no cycle. Both are claims about a
  // contract, and neither is written until confirmed below.
  const campaign = await adapter.createCampaign({
    name: result.campaign.name,
    company: result.campaign.company,
    approval_mode: result.campaign.approval_mode ?? 'none',
    default_setup: null,
    // A document never states this. SPEC section 7.
    daily_post_quota: 0,
    pay_per_video_cents: null,
    cycle_size: null,
    brief_is_incomplete: result.brief_is_incomplete,
  })

  // The raw text is kept forever, so the brief page can render the real
  // document and any quote can be checked against it again later.
  const documents = new Map<'brief' | 'contract', string>()
  if (input.briefText !== null) {
    const row = await adapter.addCampaignDocument({
      campaign_id: campaign.id,
      kind: 'brief',
      filename: input.briefFilename,
      raw_text: input.briefText,
    })
    documents.set('brief', row.id)
  }
  if (input.contractText !== null) {
    const row = await adapter.addCampaignDocument({
      campaign_id: campaign.id,
      kind: 'contract',
      filename: input.contractFilename,
      raw_text: input.contractText,
    })
    documents.set('contract', row.id)
  }

  for (const [key, field] of Object.entries(result.fields)) {
    const found = field.value !== null && field.source_quote !== null

    await adapter.setCampaignField({
      campaign_id: campaign.id,
      field_key: key,
      field_value: found ? field.value : null,
      // Amber until he taps it. Anything the parser could not stand behind is
      // "not saved yet" - blank, and visibly so.
      source: found ? 'parsed_unreviewed' : 'missing',
      source_quote: found ? field.source_quote : null,
      source_document_id: (field.from && documents.get(field.from)) ?? null,
    })

    // His tap is what promotes it. With a quote behind it the adapter makes it
    // `documented`; without one it can only ever be `user_entered`.
    if (found && confirmed.has(key)) {
      await adapter.confirmCampaignField(campaign.id, key)
    }
  }

  // Confirmed numbers become the campaign's operating figures.
  const patch: Partial<Campaign> = {}
  for (const [fieldKey, column] of Object.entries(COLUMN_FIELDS)) {
    const field = result.fields[fieldKey]
    if (!field || field.value === null || !confirmed.has(fieldKey)) continue
    const cents = Number(field.value)
    // Money is integer cents; a cycle size is a whole number of posts.
    if (!Number.isInteger(cents) || cents < 0) continue
    patch[column] = cents as never
  }
  const withColumns =
    Object.keys(patch).length > 0 ? await adapter.updateCampaign(campaign.id, patch) : campaign

  for (const [index, tier] of result.bonus_tiers.entries()) {
    await adapter.addBonusTier({
      campaign_id: campaign.id,
      label: tier.label,
      threshold_views: tier.threshold_views,
      payout_cents: tier.payout_cents,
      view_window_days: tier.view_window_days,
    })
    void index
  }

  for (const [index, body] of result.rules.entries()) {
    await adapter.addCampaignRule({
      campaign_id: campaign.id,
      body,
      // Read out of the campaign's own brief, which is what verified means
      // here - not that anybody has checked the wording.
      is_verified: true,
      sort_order: index + 1,
    })
  }

  return withColumns
}
