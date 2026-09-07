// Loads the seed campaign, once, and then never again.
//
// It used to check only whether the campaign existed, and ran at every start,
// so the campaign came back whenever it was missing - which meant deleting it
// did nothing and it could not be got rid of. It is his campaign, not the
// app's: after the first run the marker below stops it being rewritten under
// him, whatever he does to it.
//
// Still idempotent by fixed id, so a device that seeded before the marker
// existed does not get a second copy.

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

/** Set once the seed has run on this device. Client-side state: whether a
 *  campaign was ever offered is not a fact about the account, and syncing it
 *  would let one device's deletion re-seed another. */
const SEEDED_KEY = 'ugc-planner.seeded'

function alreadySeeded(): boolean {
  try {
    return localStorage.getItem(SEEDED_KEY) !== null
  } catch {
    // Private mode, or storage blocked. Fall back to the id check below, which
    // is the behaviour this had before the marker existed.
    return false
  }
}

function markSeeded(): void {
  try {
    localStorage.setItem(SEEDED_KEY, new Date().toISOString())
  } catch {
    /* nothing to do - the id check still stops a duplicate */
  }
}

/** Forgets that the seed has run, so the next start offers it again.
 *
 *  For the reset button: wiping the store without clearing this would leave a
 *  device with no campaigns and no way to get the starting one back. Deleting
 *  a campaign by hand deliberately does not call this - that is him removing
 *  it, not the store being emptied. */
export function forgetSeeded(): void {
  try {
    localStorage.removeItem(SEEDED_KEY)
  } catch {
    /* nothing stored, nothing to forget */
  }
}

/** Creates the Inflow campaign the first time, and never again. Returns true
 *  if it wrote anything. */
export async function ensureSeeded(adapter: DataAdapter): Promise<boolean> {
  // He has seen it once. If it is gone now, he removed it.
  if (alreadySeeded()) return false

  const existing = await adapter.getCampaign(INFLOW_CAMPAIGN_ID)
  if (existing) {
    // Seeded before the marker existed. Record it so this is the last time.
    markSeeded()
    return false
  }

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

  // Where it posts, as rows rather than as the `platforms` and `handle_*`
  // fields the seed also carries. Those fields describe the campaign; these
  // are what the posting grid draws and what a handle actually belongs to.
  // Nothing is invented: both the platforms and the handle come from the
  // fields above, and no email or password is guessed.
  let order = 0
  for (const platform of ['TikTok', 'Instagram']) {
    await adapter.addCampaignAccount({
      campaign_id: INFLOW_CAMPAIGN_ID,
      platform,
      handle: '@michael.financier',
      status: 'ready',
      sort_order: order++,
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

  markSeeded()
  return true
}
