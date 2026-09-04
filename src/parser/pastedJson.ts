// The path that works today.
//
// He runs the documents through a model himself, pastes the JSON it produced,
// and the app treats it with exactly the same suspicion it will treat the Edge
// Function's output with: every field needs a quote, and every quote has to be
// findable in the text he uploaded.

import { APPROVAL_MODE_VALUES, type ApprovalMode } from '../data'
import { ParseError, type CampaignParser, type ParseInput, type ParseResult, type ParsedBonusTier, type ParsedField } from './types'

/** The shape to paste. Documented on the drop box so he can hand it to a model
 *  as the schema to fill in. */
export const PASTE_SCHEMA_EXAMPLE = `{
  "campaign": {
    "name": "Campaign name",
    "company": "Company name",
    "approval_mode": "none | video | script_and_video | brand_scripted"
  },
  "fields": {
    "pay_per_video_cents": {
      "value": "3500",
      "source_quote": "$35.00 per approved deliverable",
      "from": "contract"
    }
  },
  "bonus_tiers": [
    { "label": "50,000 views", "threshold_views": 50000,
      "payout_cents": 5000, "view_window_days": 30 }
  ],
  "rules": ["Never name a competitor."]
}`

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ParseError(`${what} must be an object.`)
  }
  return value as Record<string, unknown>
}

function optionalText(value: unknown, what: string): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new ParseError(`${what} must be text.`)
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function optionalInteger(value: unknown, what: string): number | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ParseError(`${what} must be a whole number.`)
  }
  return value
}

function parseFields(raw: unknown): Record<string, ParsedField> {
  if (raw === undefined || raw === null) return {}
  const record = asRecord(raw, 'fields')
  const fields: Record<string, ParsedField> = {}

  for (const [key, entry] of Object.entries(record)) {
    // A bare string is accepted and then rejected by verification for having
    // no quote. Refusing it here would only push him toward inventing one.
    if (typeof entry === 'string') {
      fields[key] = { value: entry, source_quote: null }
      continue
    }

    const object = asRecord(entry, `fields.${key}`)
    const from = optionalText(object.from, `fields.${key}.from`)
    if (from !== null && from !== 'brief' && from !== 'contract') {
      throw new ParseError(`fields.${key}.from must be "brief" or "contract".`)
    }

    fields[key] = {
      value: optionalText(object.value, `fields.${key}.value`),
      source_quote: optionalText(object.source_quote, `fields.${key}.source_quote`),
      ...(from === null ? {} : { from }),
    }
  }

  return fields
}

function parseBonusTiers(raw: unknown): ParsedBonusTier[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new ParseError('bonus_tiers must be a list.')

  return raw.map((entry, i) => {
    const object = asRecord(entry, `bonus_tiers[${i}]`)
    const threshold = optionalInteger(object.threshold_views, `bonus_tiers[${i}].threshold_views`)
    const payout = optionalInteger(object.payout_cents, `bonus_tiers[${i}].payout_cents`)

    if (threshold === null || payout === null) {
      throw new ParseError(`bonus_tiers[${i}] needs threshold_views and payout_cents.`)
    }

    return {
      label: optionalText(object.label, `bonus_tiers[${i}].label`) ?? `${threshold} views`,
      threshold_views: threshold,
      payout_cents: payout,
      view_window_days: optionalInteger(
        object.view_window_days,
        `bonus_tiers[${i}].view_window_days`,
      ),
    }
  })
}

function parseRules(raw: unknown): string[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new ParseError('rules must be a list of strings.')
  return raw.map((entry, i) => {
    const text = optionalText(entry, `rules[${i}]`)
    if (text === null) throw new ParseError(`rules[${i}] is empty.`)
    return text
  })
}

export class PastedJsonParser implements CampaignParser {
  readonly name = 'Pasted JSON'

  isAvailable(): boolean {
    return true
  }

  // async, so that every failure is a rejection. A Promise-returning method
  // that sometimes throws synchronously cannot be handled with .catch() alone,
  // and a caller who wrote only that would lose the error entirely.
  async parse(input: ParseInput): Promise<ParseResult> {
    if (!input.json || input.json.trim() === '') {
      throw new ParseError('Nothing pasted.')
    }

    let raw: unknown
    try {
      raw = JSON.parse(input.json)
    } catch {
      throw new ParseError('That is not valid JSON.')
    }

    const root = asRecord(raw, 'The pasted value')
    const campaignRaw = asRecord(root.campaign ?? {}, 'campaign')

    const name = optionalText(campaignRaw.name, 'campaign.name')
    if (name === null) {
      // Everything else can be missing and reviewed later. A campaign with no
      // name is not a campaign.
      throw new ParseError('campaign.name is required.')
    }

    const approvalRaw = optionalText(campaignRaw.approval_mode, 'campaign.approval_mode')
    let approval_mode: ApprovalMode | null = null
    if (approvalRaw !== null) {
      if (!(APPROVAL_MODE_VALUES as readonly string[]).includes(approvalRaw)) {
        throw new ParseError(
          `campaign.approval_mode must be one of ${APPROVAL_MODE_VALUES.join(', ')}.`,
        )
      }
      approval_mode = approvalRaw as ApprovalMode
    }

    return {
      campaign: {
        name,
        company: optionalText(campaignRaw.company, 'campaign.company'),
        approval_mode,
      },
      fields: parseFields(root.fields),
      bonus_tiers: parseBonusTiers(root.bonus_tiers),
      rules: parseRules(root.rules),
      // Filled in by the caller from inspectBrief, which reads the document
      // rather than taking the paste's word for it.
      brief_is_incomplete: false,
      warnings: [],
    }
  }
}
