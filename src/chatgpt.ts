// The "copy for ChatGPT" block. SPEC section 7: one clean paste-ready block -
// product, hard rules, structure, voice guide.
//
// Composed only from what is stored. A section with nothing behind it says so
// rather than being filled in with something plausible: he is about to paste
// this into a model and generate a script from it, so an invented "hard rule"
// here becomes an invented rule in a video that goes to a brand.

import type { Campaign, CampaignField, CampaignRule } from './data'

const NOT_SAVED = '(not saved yet)'

function fieldValue(fields: readonly CampaignField[], key: string): string | null {
  const field = fields.find((f) => f.field_key === key)
  if (!field || field.source === 'missing') return null
  return field.field_value
}

export function buildChatGptBlock(
  campaign: Campaign,
  fields: readonly CampaignField[],
  rules: readonly CampaignRule[],
): string {
  const lines: string[] = []

  lines.push(`CAMPAIGN: ${campaign.name}${campaign.company ? ` (${campaign.company})` : ''}`)
  lines.push('')

  lines.push('PRODUCT')
  lines.push(fieldValue(fields, 'product_facts') ?? NOT_SAVED)
  lines.push('')

  lines.push('HARD RULES - NEVER BREAK THESE')
  if (rules.length === 0) {
    lines.push(NOT_SAVED)
  } else {
    for (const rule of rules) lines.push(`- ${rule.body}`)
  }
  if (campaign.brief_is_incomplete) {
    // He should know the list may be short before he asks a model to write
    // against it. The brief this came from lost sections in conversion.
    lines.push('')
    lines.push('NOTE: this brief is incomplete, so these rules may be missing some.')
  }
  lines.push('')

  lines.push('STRUCTURE')
  lines.push(fieldValue(fields, 'structure') ?? NOT_SAVED)
  lines.push('')

  lines.push('VOICE')
  lines.push(fieldValue(fields, 'tone') ?? NOT_SAVED)
  lines.push('')

  lines.push('AUDIENCE')
  lines.push(fieldValue(fields, 'audience') ?? NOT_SAVED)

  const technical = fieldValue(fields, 'technical_spec')
  if (technical) {
    lines.push('')
    lines.push('TECHNICAL')
    lines.push(technical)
  }

  return lines.join('\n')
}
