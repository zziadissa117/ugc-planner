// Turning a reviewed parse into campaign rows.
//
// Nothing here decides what is true. Every value arrives already carrying its
// provenance, and the only judgement this makes is the one the review screen
// recorded: which fields he tapped to confirm.

import type { Campaign, DataAdapter } from '../data'
import { COLUMN_FIELDS } from '../data/campaignFields'
import type { ParseResult } from './types'

export interface ApplyInput {
  result: ParseResult
  /** Field keys he tapped to confirm on the review screen. */
  confirmed: ReadonlySet<string>
  briefText: string | null
  briefFilename: string | null
  contractText: string | null
  contractFilename: string | null
  /** Indexes into `result.rules` he unticked on the review screen. */
  excludedRules?: ReadonlySet<number>
  /** Indexes into `result.bonus_tiers` he unticked on the review screen. */
  excludedTiers?: ReadonlySet<number>
}

export async function applyParseResult(
  outerAdapter: DataAdapter,
  input: ApplyInput,
): Promise<Campaign> {
  // A campaign is not one write - it is a row, its documents, a field per
  // extracted value, its tiers and its rules. Half of that is not a campaign
  // with some parts missing; it is a campaign that lies about what its
  // documents said. All of it lands, or none of it does.
  return outerAdapter.runTransaction((adapter) => applyWithin(adapter, input))
}

async function applyWithin(adapter: DataAdapter, input: ApplyInput): Promise<Campaign> {
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

  // Only what survived verifyQuotes reaches here, and only what he left
  // ticked on the review screen: each tier's line was found in the contract
  // and states both its numbers, each rule's quote was found in a document.
  const excludedTiers = input.excludedTiers ?? new Set<number>()
  for (const [index, tier] of result.bonus_tiers.entries()) {
    if (excludedTiers.has(index)) continue
    await adapter.addBonusTier({
      campaign_id: campaign.id,
      label: tier.label,
      threshold_views: tier.threshold_views,
      payout_cents: tier.payout_cents,
      view_window_days: tier.view_window_days,
    })
  }

  const excludedRules = input.excludedRules ?? new Set<number>()
  let order = 0
  for (const [index, rule] of result.rules.entries()) {
    if (excludedRules.has(index)) continue
    await adapter.addCampaignRule({
      campaign_id: campaign.id,
      body: rule.body,
      // Verified means its quote was found in the campaign's own documents -
      // not that anybody has checked the wording.
      is_verified: true,
      sort_order: ++order,
    })
  }

  return withColumns
}
