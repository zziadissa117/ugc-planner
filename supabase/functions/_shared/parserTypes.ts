// GENERATED from src/parser/types.ts by scripts/vendor-shared.mjs - do not edit.
// Change the source and run `node scripts/vendor-shared.mjs`.

// The campaign parser contract.
//
// SPEC section 7: the real parser runs server-side, in the parse-campaign
// Edge Function, so the model key stays a server secret and never reaches the
// browser. PastedJsonParser is the path that works with no network at all.
//
// Both go through the same verification, because the rule that matters is not
// about who parsed - it is that no extracted value is trusted unless the exact
// text it came from can still be found in the document.

export type ApprovalMode = 'none' | 'video' | 'script_and_video' | 'brand_scripted'

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
  /** Something about this value that deserves a second look before he
   *  confirms it - the document states two different rates, the text around
   *  it is garbled, it only holds under a condition. Written by the parser,
   *  shown beside the field, never stored. Absent means nothing to flag, not
   *  that the value is certain: every parsed field is still amber until he
   *  taps it. */
  note?: string | null
}

/** A never-do rule read out of a document, with the words it came from.
 *
 *  Rules used to be bare strings, written straight to the campaign as
 *  verified with nothing checking that any document said them. A rule is
 *  campaign content like any other - "never invent a rule" is in CLAUDE.md
 *  beside rates and hooks - so it carries a quote and survives only if that
 *  quote can be found. `body` may be a tidied version of the quote; the quote
 *  itself must be verbatim. */
export interface ParsedRule {
  body: string
  source_quote: string | null
  from?: 'brief' | 'contract'
}

export interface ParsedBonusTier {
  label: string
  threshold_views: number
  payout_cents: number
  view_window_days: number | null
  /** The line the tier was read from. Money, so it gets the strictest check
   *  in the parser: the quote must be in the document AND must itself contain
   *  both the view count and the payout. See verifyBonusTiers. */
  source_quote: string | null
  from?: 'brief' | 'contract'
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
  /** Never-do rules read from the documents. */
  rules: ParsedRule[]
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
  'account_email',
  'account_password',
  'editing_style',
  'setup type',
  'real film / edit / post minutes',
  'daily post quota',
] as const
