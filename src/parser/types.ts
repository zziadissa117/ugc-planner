// The campaign parser contract.
//
// SPEC section 7: the real parser runs server-side, in a Supabase Edge
// Function that calls a model API, so the key stays a server secret and never
// reaches the browser. That function is not deployed, so EdgeFunctionParser is
// a stub and PastedJsonParser is the path that works today.
//
// Both go through the same verification, because the rule that matters is not
// about who parsed - it is that no extracted value is trusted unless the exact
// text it came from can still be found in the document.

import type { ApprovalMode } from '../data'

/** One extracted value and the exact substring it came from.
 *
 *  `source_quote` is not decoration. A model asked for structured output will
 *  produce confident, well-formatted, entirely invented values; requiring it to
 *  also hand back the exact text it read them from turns that from a matter of
 *  trust into something checkable by string search. */
export interface ParsedField {
  value: string | null
  source_quote: string | null
  /** Which uploaded document the quote should be found in. */
  from?: 'brief' | 'contract'
}

export interface ParsedBonusTier {
  label: string
  threshold_views: number
  payout_cents: number
  view_window_days: number | null
}

export interface ParseResult {
  /** Operational values for the campaign row. Deliberately excludes anything
   *  that has to be reviewed first - a rate or a cycle size arrives through
   *  `fields`, where it carries a quote and can be confirmed. */
  campaign: {
    name: string
    company: string | null
    approval_mode: ApprovalMode | null
  }
  /** Everything with provenance, keyed by field_key. */
  fields: Record<string, ParsedField>
  bonus_tiers: ParsedBonusTier[]
  /** Never-do rules read from the brief. */
  rules: string[]
  /** Set when the brief looks like it lost sections in conversion. */
  brief_is_incomplete: boolean
  /** Plain-language notes for the review screen. */
  warnings: string[]
}

export interface ParseInput {
  briefText: string | null
  contractText: string | null
  /** Only the pasted-JSON path uses this. */
  json?: string
}

export interface CampaignParser {
  readonly name: string
  /** True when this parser can actually run right now. */
  isAvailable(): boolean
  parse(input: ParseInput): Promise<ParseResult>
}

export class ParserUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParserUnavailableError'
  }
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParseError'
  }
}

/** Fields no document ever contains. SPEC section 7.
 *
 *  These are never parsed, never inferred, and never guessed at from context.
 *  The review screen says so in one plain line, so that "it did not fill that
 *  in" reads as the app working rather than as a bug. */
export const NEVER_PARSED_FIELDS = [
  'handle_tiktok',
  'handle_instagram',
  'setup type',
  'real film / edit / post minutes',
  'daily post quota',
] as const
