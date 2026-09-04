// Loads the seed campaign, once.
//
// Idempotent by fixed id: running it twice adds nothing. It runs at startup,
// so a full reset brings the campaign back - which is what the acceptance
// check describes, since the ledger is then empty except for the user-entered
// opening balance the seed carries.

import type { DataAdapter } from '../DataAdapter'
import {
  INFLOW_ANGLES_UNVERIFIED,
  INFLOW_ANGLES_VERIFIED,
  INFLOW_BONUS_TIERS,
  INFLOW_CAMPAIGN,
  INFLOW_CAMPAIGN_ID,
  INFLOW_FIELDS,
  INFLOW_RULES,
} from './inflow'

export { INFLOW_CAMPAIGN_ID } from './inflow'

/** Creates the Inflow campaign if it is not already there. Returns true if it
 *  wrote anything. */
export async function ensureSeeded(adapter: DataAdapter): Promise<boolean> {
  const existing = await adapter.getCampaign(INFLOW_CAMPAIGN_ID)
  if (existing) return false

  await adapter.createCampaign(INFLOW_CAMPAIGN)

  for (const field of INFLOW_FIELDS) {
    await adapter.setCampaignField({
      campaign_id: INFLOW_CAMPAIGN_ID,
      field_key: field.field_key,
      field_value: field.field_value,
      source: field.source,
      // No quote, because no document is stored to quote from. This is what
      // keeps every one of these out of `documented`.
      source_quote: null,
      source_document_id: null,
    })
  }

  // The six from the brief and the two from the skill file go in as separate
  // sets and stay separate: is_verified is what the brief page splits on.
  for (const angle of [...INFLOW_ANGLES_VERIFIED, ...INFLOW_ANGLES_UNVERIFIED]) {
    await adapter.addCampaignAngle({
      id: angle.id,
      campaign_id: INFLOW_CAMPAIGN_ID,
      label: angle.label,
      body: angle.body,
      family: angle.family,
      is_verified: angle.is_verified,
      sort_order: angle.sort_order,
    })
  }

  for (const rule of INFLOW_RULES) {
    await adapter.addCampaignRule({
      id: rule.id,
      campaign_id: INFLOW_CAMPAIGN_ID,
      body: rule.body,
      is_verified: true,
      sort_order: rule.sort_order,
    })
  }

  for (const tier of INFLOW_BONUS_TIERS) {
    await adapter.addBonusTier({
      id: tier.id,
      campaign_id: INFLOW_CAMPAIGN_ID,
      label: tier.label,
      threshold_views: tier.threshold_views,
      payout_cents: tier.payout_cents,
      view_window_days: tier.view_window_days,
    })
  }

  return true
}
