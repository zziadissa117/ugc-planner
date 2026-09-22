// The mechanical fabrication check, and the damaged-brief detector.
//
// SPEC section 7 puts the quote check inside the Edge Function, and it runs
// there - from a copy of this file that scripts/vendor-shared.mjs generates.
// It lives here as a pure function so the pasted-JSON path gets exactly the
// same treatment, and so the server and the client cannot drift into
// disagreeing about what "verified" means.

import type { ParseResult, ParsedBonusTier, ParsedField, ParsedRule } from './types'

/** Normalises whitespace for comparison.
 *
 *  These documents are PDF conversions: they arrive with soft line breaks in
 *  the middle of sentences, doubled spaces, and non-breaking spaces where a
 *  layout engine put them. A quote that is right about the words but differs
 *  in whitespace is a correct quote, and failing it would blank good data. A
 *  quote that is wrong about the words is a fabrication, and no amount of
 *  normalising will rescue it - which is exactly the line this draws. */
function normalise(text: string): string {
  return text
    .replace(/ /g, ' ')
    // Curly quotes and dashes survive conversion inconsistently.
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export interface VerificationOutcome {
  result: ParseResult
  /** Field keys that were blanked because their quote could not be found. */
  rejected: string[]
  /** Rules dropped because no document says them. */
  rejectedRules: string[]
  /** Bonus tiers dropped - by label - because their line is not in the
   *  document, or does not itself state the views and the payout. */
  rejectedTiers: string[]
}

/** Forces to missing any field whose quote is absent from the source text.
 *
 *  A field survives only if it has a quote AND that quote appears verbatim in
 *  the document it claims to come from. Everything else is blanked to a null
 *  value with no quote, which renders "not saved yet".
 *
 *  Blanked rather than dropped, deliberately: the field key stays visible on
 *  the review screen, so a value the parser invented becomes an obvious gap
 *  rather than silently vanishing as though never attempted. */
export function verifyQuotes(
  result: ParseResult,
  documents: { briefText: string | null; contractText: string | null },
): VerificationOutcome {
  const haystacks = {
    brief: documents.briefText === null ? null : normalise(documents.briefText),
    contract: documents.contractText === null ? null : normalise(documents.contractText),
  }
  // With no `from`, a quote may come from either document.
  const anywhere = [haystacks.brief, haystacks.contract].filter((h): h is string => h !== null)

  const fields: Record<string, ParsedField> = {}
  const rejected: string[] = []

  for (const [key, field] of Object.entries(result.fields)) {
    if (field.value === null) {
      // Already absent. Nothing to verify, nothing to reject.
      fields[key] = { value: null, source_quote: null }
      continue
    }

    if (field.source_quote === null || field.source_quote.trim() === '') {
      rejected.push(key)
      fields[key] = { value: null, source_quote: null }
      continue
    }

    const needle = normalise(field.source_quote)
    const searched = field.from ? [haystacks[field.from]].filter((h) => h !== null) : anywhere
    const found = searched.some((haystack) => haystack.includes(needle))

    if (found) {
      fields[key] = field
    } else {
      rejected.push(key)
      fields[key] = { value: null, source_quote: null }
    }
  }

  const rules = verifyRules(result.rules ?? [], haystacks, anywhere)
  const tiers = verifyBonusTiers(result.bonus_tiers ?? [], haystacks, anywhere)

  const warnings = [...result.warnings]
  if (rejected.length > 0) {
    warnings.push(
      `${rejected.length} ${rejected.length === 1 ? 'field was' : 'fields were'} dropped: the text they claimed to come from is not in the document.`,
    )
  }
  if (rules.rejected.length > 0) {
    warnings.push(
      `${rules.rejected.length} never-do ${rules.rejected.length === 1 ? 'rule was' : 'rules were'} dropped: no document says ${rules.rejected.length === 1 ? 'it' : 'them'}.`,
    )
  }
  if (tiers.rejected.length > 0) {
    warnings.push(
      `${tiers.rejected.length} bonus ${tiers.rejected.length === 1 ? 'tier was' : 'tiers were'} dropped: the line quoted for ${tiers.rejected.length === 1 ? 'it' : 'them'} is not in the contract, or does not state both the views and the payout.`,
    )
  }

  return {
    result: { ...result, fields, rules: rules.kept, bonus_tiers: tiers.kept, warnings },
    rejected,
    rejectedRules: rules.rejected,
    rejectedTiers: tiers.rejected,
  }
}

type Haystacks = { brief: string | null; contract: string | null }

function quoteFound(
  quote: string | null,
  from: 'brief' | 'contract' | undefined,
  haystacks: Haystacks,
  anywhere: readonly string[],
): boolean {
  if (quote === null || quote.trim() === '') return false
  const needle = normalise(quote)
  const searched = from ? [haystacks[from]].filter((h): h is string => h !== null) : anywhere
  return searched.some((haystack) => haystack.includes(needle))
}

/** Keeps only the rules a document actually states.
 *
 *  Dropped rather than blanked: a rule has no key to leave visible, and an
 *  invented never-do line is not a gap to fill in later - it is a constraint
 *  on his videos that nobody asked for. */
function verifyRules(
  rules: readonly ParsedRule[],
  haystacks: Haystacks,
  anywhere: readonly string[],
): { kept: ParsedRule[]; rejected: string[] } {
  const kept: ParsedRule[] = []
  const rejected: string[] = []
  for (const rule of rules) {
    if (typeof rule?.body !== 'string' || rule.body.trim() === '') continue
    if (quoteFound(rule.source_quote, rule.from, haystacks, anywhere)) kept.push(rule)
    else rejected.push(rule.body)
  }
  return { kept, rejected }
}

/** Every number written in a piece of text, read the ways contracts write
 *  them: "50,000", "50000", "50k", "1.5M", "$50.00". */
function numbersIn(text: string): number[] {
  const found: number[] = []
  for (const match of text.matchAll(/(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*([km])?\b/gi)) {
    const whole = Number(match[1].replace(/,/g, ''))
    const fraction = match[2] === undefined ? 0 : Number(`0.${match[2]}`)
    const multiplier =
      match[3] === undefined ? 1 : match[3].toLowerCase() === 'k' ? 1_000 : 1_000_000
    found.push((whole + fraction) * multiplier)
  }
  return found
}

/** Keeps only tiers whose line is in the document and says both numbers.
 *
 *  A bonus tier is money, and it used to be written with no check at all. A
 *  quote that merely exists is not enough here: "50,000 views" could be
 *  found in a contract while the payout beside it was invented. So the quote
 *  itself has to carry the view threshold and the payout, in any of the ways
 *  a contract writes a number. A view window the documents never mention is
 *  blanked rather than kept - the same rule as any other field. */
function verifyBonusTiers(
  tiers: readonly ParsedBonusTier[],
  haystacks: Haystacks,
  anywhere: readonly string[],
): { kept: ParsedBonusTier[]; rejected: string[] } {
  const kept: ParsedBonusTier[] = []
  const rejected: string[] = []
  const allText = anywhere.join(' ')

  for (const tier of tiers) {
    const label = typeof tier?.label === 'string' ? tier.label : String(tier?.threshold_views)
    if (!quoteFound(tier.source_quote, tier.from, haystacks, anywhere)) {
      rejected.push(label)
      continue
    }
    const numbers = numbersIn(normalise(tier.source_quote as string))
    const statesViews = numbers.some((n) => Math.round(n) === tier.threshold_views)
    const statesPayout = numbers.some((n) => Math.round(n * 100) === tier.payout_cents)
    if (!statesViews || !statesPayout) {
      rejected.push(label)
      continue
    }
    const window = tier.view_window_days
    const windowStated =
      window !== null && new RegExp(`\\b${window}[\\s-]*days?\\b`).test(allText)
    kept.push({ ...tier, view_window_days: windowStated ? window : null })
  }
  return { kept, rejected }
}

/** Whether a field's value can be read straight off its quote, rather than
 *  being the parser's own summary of it.
 *
 *  Both are allowed - the four brief fields are condensed on purpose - but
 *  they deserve different attention on the review screen: a rate that is
 *  literally in the quoted line is a glance, a paragraph condensed from a
 *  passage is something to read. Mechanical, so it does not depend on the
 *  parser's opinion of its own work. Money fields are cents and are matched
 *  against the dollar amounts in the quote; counts against its numbers. */
export function valueIsInQuote(
  value: string | null,
  quote: string | null,
  kind: 'money' | 'count' | 'text',
): boolean {
  if (value === null || quote === null) return false
  if (kind === 'text') return normalise(quote).includes(normalise(value))
  const target = Number(value)
  if (!Number.isFinite(target)) return false
  const numbers = numbersIn(normalise(quote))
  return kind === 'money'
    ? numbers.some((n) => Math.round(n * 100) === target)
    : numbers.some((n) => Math.round(n) === target)
}

// ---------------------------------------------------------------------------
// Damaged briefs
// ---------------------------------------------------------------------------

const SECTION_HEADING = /^\s*#{0,6}\s*(?:section\s+)?(\d{1,2})[.)]\s+\S/gim
const SECTION_REFERENCE = /\bsection\s+(\d{1,2})\b/gi

export interface BriefIntegrity {
  isIncomplete: boolean
  reasons: string[]
}

/** Looks for the marks a lossy PDF conversion leaves.
 *
 *  These files lose headings, scramble tables and carry OCR garbage. A missing
 *  section is not an absent rule - it is a rule we cannot see - so the point is
 *  to notice and say so rather than to quietly present a short list as
 *  complete. Two signals, both conservative:
 *
 *    - section numbers that skip, meaning a heading did not survive
 *    - a cross-reference to a section whose text is not present
 *
 *  It never throws. A brief that defeats it entirely simply reads as intact,
 *  which is the same position the app was in before it looked. */
export function inspectBrief(text: string): BriefIntegrity {
  const reasons: string[] = []

  const present = new Set<number>()
  for (const match of text.matchAll(SECTION_HEADING)) {
    present.add(Number(match[1]))
  }

  if (present.size >= 2) {
    const numbers = [...present].sort((a, b) => a - b)
    const missing: number[] = []
    for (let n = numbers[0]; n < numbers[numbers.length - 1]; n++) {
      if (!present.has(n)) missing.push(n)
    }
    if (missing.length > 0) {
      reasons.push(
        `Section ${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} no heading in this file.`,
      )
    }
  }

  const dangling = new Set<number>()
  for (const match of text.matchAll(SECTION_REFERENCE)) {
    const referenced = Number(match[1])
    if (present.size > 0 && !present.has(referenced)) dangling.add(referenced)
  }
  if (dangling.size > 0) {
    reasons.push(
      `The text points at section ${[...dangling].sort((a, b) => a - b).join(', ')}, which is not in this file.`,
    )
  }

  return { isIncomplete: reasons.length > 0, reasons }
}
