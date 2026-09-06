// Vendored from src/parser/types.ts.
//
// Edge Functions run on Deno and are deployed independently of the app
// bundle, so this cannot import across the src/ boundary. Per
// docs/EDGE_FUNCTION.md this is copied, not reimplemented - keep it identical
// to the client's src/parser/types.ts. If the shape of ParseResult changes on
// the client, change it here too in the same commit.

export type ApprovalMode = 'none' | 'video' | 'script_and_video' | 'brand_scripted'

export interface ParsedField {
  value: string | null
  source_quote: string | null
  from?: 'brief' | 'contract'
}

export interface ParsedBonusTier {
  label: string
  threshold_views: number
  payout_cents: number
  view_window_days: number | null
}

export interface ParseResult {
  campaign: {
    name: string
    company: string | null
    approval_mode: ApprovalMode | null
  }
  fields: Record<string, ParsedField>
  bonus_tiers: ParsedBonusTier[]
  rules: string[]
  brief_is_incomplete: boolean
  warnings: string[]
}

// SPEC section 7 / src/parser/types.ts NEVER_PARSED_FIELDS. No document ever
// contains these; if the model returns them anyway, the handler drops them
// before the response leaves the function.
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
