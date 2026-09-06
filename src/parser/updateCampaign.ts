// Merging a re-parsed document into a campaign that already exists.
//
// He re-briefs every couple of weeks: a rate changes, a platform is added, a
// new document lists hooks he can use. Dropping that document through
// NewCampaign would create a second campaign - a collision, not an update -
// because applyParseResult always calls createCampaign.
//
// The rule this file exists to enforce: a field he already confirmed never
// changes without a tap. Parsing again is exactly as capable of being wrong as
// parsing the first time, so a newly parsed value disagreeing with a
// documented one is a CONFLICT to be shown, never a correction to be applied.
// Everything that is purely additive - a rule, a bonus tier, a brand new field
// - carries no such risk and is written straight away: nothing already saved
// can be lost by adding something that was not there before.

import type { BonusTier, Campaign, CampaignField, CampaignRule, DataAdapter } from '../data'
import { COLUMN_FIELDS } from '../data/campaignFields'
import type { ParsedBonusTier, ParseResult } from './types'

export interface FieldDiff {
  key: string
  parsedValue: string
  parsedQuote: string | null
  parsedFrom: 'brief' | 'contract' | null
  /** The row already on the campaign, if any - present even when the diff
   *  fell back to a column value, so its provenance can still be shown. */
  current: CampaignField | undefined
  /** What "current" actually means for this diff: the field row's value when
   *  it has one, otherwise the campaign column's value for pay_per_video_cents
   *  / cycle_size, otherwise null. This, not `current?.field_value`, is what
   *  status was decided against. */
  currentValue: string | null
  status: 'new' | 'same' | 'conflict'
}

function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** One entry per parsed field that actually has a value - a field the new
 *  document does not mention is neither new, same, nor conflicting, it is
 *  simply not part of this diff.
 *
 *  `pay_per_video_cents` and `cycle_size` are promoted straight onto the
 *  campaign row (COLUMN_FIELDS) and confirming one keeps the column and the
 *  field row in step - see confirmFieldValue in campaignFields.ts. But a
 *  campaign whose column was set some other way - directly at creation, by an
 *  import, by hand - can have an operating rate with no field row behind it at
 *  all. Falling back to "new" there would treat a changed, already-in-use rate
 *  as though nothing existed yet, and apply it without a second thought - the
 *  exact silent overwrite this diff exists to prevent. So a column field with
 *  no usable row falls back to the campaign's own column value as "current". */
export function diffFields(
  currentFields: readonly CampaignField[],
  campaign: Pick<Campaign, 'pay_per_video_cents' | 'cycle_size'>,
  result: ParseResult,
): FieldDiff[] {
  const byKey = new Map(currentFields.map((field) => [field.field_key, field]))
  const diffs: FieldDiff[] = []

  for (const [key, field] of Object.entries(result.fields)) {
    if (field.value === null) continue

    const row = byKey.get(key)
    const rowHasValue = row !== undefined && row.source !== 'missing' && row.field_value !== null
    const column = COLUMN_FIELDS[key as keyof typeof COLUMN_FIELDS]
    const columnValue = column ? campaign[column] : null

    const currentValue = rowHasValue ? (row!.field_value as string) : columnValue !== null ? String(columnValue) : null

    const status: FieldDiff['status'] =
      currentValue === null
        ? 'new'
        : normalise(currentValue) === normalise(field.value)
          ? 'same'
          : 'conflict'

    diffs.push({
      key,
      parsedValue: field.value,
      parsedQuote: field.source_quote,
      parsedFrom: field.from ?? null,
      current: row,
      currentValue,
      status,
    })
  }

  return diffs
}

/** Rule bodies the campaign does not already carry, compared on normalised
 *  text so a rule re-stated with different spacing is not treated as new.
 *  A rule missing from the new document is not evidence it stopped applying -
 *  nothing is ever removed here. */
export function newRules(currentRules: readonly CampaignRule[], result: ParseResult): string[] {
  const existing = new Set(currentRules.map((rule) => normalise(rule.body)))
  const seen = new Set<string>()
  const out: string[] = []

  for (const body of result.rules) {
    const key = normalise(body)
    if (existing.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push(body)
  }
  return out
}

/** Bonus tiers whose view threshold is not already on the campaign. The
 *  schema's own `unique (campaign_id, threshold_views)` means a duplicate
 *  would be refused anyway; filtering here is what lets everything else in
 *  the batch still apply instead of the whole update failing on one repeat. */
export function newBonusTiers(
  currentTiers: readonly BonusTier[],
  result: ParseResult,
): ParsedBonusTier[] {
  const existing = new Set(currentTiers.map((tier) => tier.threshold_views))
  const seen = new Set<number>()
  return result.bonus_tiers.filter((tier) => {
    if (existing.has(tier.threshold_views) || seen.has(tier.threshold_views)) return false
    seen.add(tier.threshold_views)
    return true
  })
}

export interface ApplyUpdateInput {
  campaignId: string
  result: ParseResult
  /** Field keys from a 'new' diff to write. Non-destructive by construction -
   *  nothing existed there before - so every new field is included by
   *  default; this exists so a genuinely unwanted one can be left out. */
  acceptedNewFieldKeys: ReadonlySet<string>
  /** Field keys from a 'conflict' diff where he tapped "Use new". Anything not
   *  in this set keeps its current value, which is the default: nothing
   *  changes without this explicit, per-field decision. */
  acceptedConflictFieldKeys: ReadonlySet<string>
  briefText: string | null
  briefFilename: string | null
  contractText: string | null
  contractFilename: string | null
}

/** Commits an update to a campaign that already exists.
 *
 *  Everything additive - new rules, new bonus tiers - is written in full;
 *  nothing about them can conflict with anything saved, so there is nothing
 *  to decide. Fields are the one thing that can disagree with a confirmed
 *  value, so they are written only for the keys explicitly accepted, and
 *  always as `parsed_unreviewed` - amber - even a field he tapped "Use new"
 *  on, because a value from a second parse deserves the same one-tap
 *  confirmation the first one did before it can be `documented`. */
export async function applyCampaignUpdate(
  adapter: DataAdapter,
  input: ApplyUpdateInput,
): Promise<void> {
  await adapter.runTransaction(async (tx) => {
    const documents = new Map<'brief' | 'contract', string>()
    if (input.briefText !== null) {
      const row = await tx.addCampaignDocument({
        campaign_id: input.campaignId,
        kind: 'brief',
        filename: input.briefFilename,
        raw_text: input.briefText,
      })
      documents.set('brief', row.id)
    }
    if (input.contractText !== null) {
      const row = await tx.addCampaignDocument({
        campaign_id: input.campaignId,
        kind: 'contract',
        filename: input.contractFilename,
        raw_text: input.contractText,
      })
      documents.set('contract', row.id)
    }

    const [campaign, currentFields, currentRules, currentTiers] = await Promise.all([
      tx.getCampaign(input.campaignId),
      tx.listCampaignFields(input.campaignId),
      tx.listCampaignRules(input.campaignId),
      tx.listBonusTiers(input.campaignId),
    ])
    if (!campaign) throw new Error(`campaign ${input.campaignId} does not exist`)

    for (const diff of diffFields(currentFields, campaign, input.result)) {
      const wanted =
        diff.status === 'new'
          ? input.acceptedNewFieldKeys.has(diff.key)
          : diff.status === 'conflict' && input.acceptedConflictFieldKeys.has(diff.key)
      if (!wanted) continue

      await tx.setCampaignField({
        campaign_id: input.campaignId,
        field_key: diff.key,
        field_value: diff.parsedValue,
        source: 'parsed_unreviewed',
        source_quote: diff.parsedQuote,
        source_document_id: (diff.parsedFrom && documents.get(diff.parsedFrom)) ?? null,
      })
    }

    const existingRuleCount = currentRules.length
    for (const [index, body] of newRules(currentRules, input.result).entries()) {
      await tx.addCampaignRule({
        campaign_id: input.campaignId,
        body,
        // Read out of the campaign's own newer brief - the same standing as a
        // rule from the first parse.
        is_verified: true,
        sort_order: existingRuleCount + index + 1,
      })
    }

    for (const tier of newBonusTiers(currentTiers, input.result)) {
      await tx.addBonusTier({
        campaign_id: input.campaignId,
        label: tier.label,
        threshold_views: tier.threshold_views,
        payout_cents: tier.payout_cents,
        view_window_days: tier.view_window_days,
      })
    }
  })
}
