// Vendored from src/parser/verify.ts - same logic, not a reimplementation.
//
// docs/EDGE_FUNCTION.md is explicit: the function must run verifyQuotes, not
// a second version of it. Two implementations of "is this quote real?" will
// drift, and the day they disagree is the day a fabricated rate gets written
// as `documented`. If src/parser/verify.ts changes, mirror the change here in
// the same commit - do not "simplify" the whitespace normalisation, it is
// load-bearing (see the comment below).

import type { ParseResult, ParsedField } from './parserTypes.ts'

function normalise(text: string): string {
  return text
    .replace(/ /g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export interface VerificationOutcome {
  result: ParseResult
  rejected: string[]
}

export function verifyQuotes(
  result: ParseResult,
  documents: { briefText: string | null; contractText: string | null },
): VerificationOutcome {
  const haystacks = {
    brief: documents.briefText === null ? null : normalise(documents.briefText),
    contract: documents.contractText === null ? null : normalise(documents.contractText),
  }
  const anywhere = [haystacks.brief, haystacks.contract].filter((h): h is string => h !== null)

  const fields: Record<string, ParsedField> = {}
  const rejected: string[] = []

  for (const [key, field] of Object.entries(result.fields)) {
    if (field.value === null) {
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
