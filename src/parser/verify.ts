// The mechanical fabrication check, and the damaged-brief detector.
//
// SPEC section 7 puts the quote check inside the Edge Function, which is where
// it will run once that exists. It lives here as a pure function so the
// pasted-JSON path gets exactly the same treatment today, and so the server
// and the client cannot drift into disagreeing about what "verified" means.

import type { ParseResult, ParsedField } from './types'

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

  const warnings = [...result.warnings]
  if (rejected.length > 0) {
    warnings.push(
      `${rejected.length} ${rejected.length === 1 ? 'field was' : 'fields were'} dropped: the text they claimed to come from is not in the document.`,
    )
  }

  return { result: { ...result, fields, warnings }, rejected }
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
