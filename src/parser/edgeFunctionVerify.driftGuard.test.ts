// docs/EDGE_FUNCTION.md requires the deployed function to run the *same*
// verifyQuotes/inspectBrief logic as the client, copied into
// supabase/functions/_shared, not reimplemented. This guards that the copy
// has not silently drifted from the source: same inputs, same outputs. If
// this fails, the fix is to re-copy src/parser/verify.ts into
// supabase/functions/_shared/verify.ts, never to special-case the vendored
// copy until it passes.

import { describe, expect, it } from 'vitest'

import type { ParseResult } from './types'
import { inspectBrief as clientInspectBrief, verifyQuotes as clientVerifyQuotes } from './verify'
// The .ts extension is required for the Deno-deployed copy; Vite/Vitest resolve it fine too.
import {
  inspectBrief as vendoredInspectBrief,
  verifyQuotes as vendoredVerifyQuotes,
} from '../../supabase/functions/_shared/verify.ts'

const CONTRACT = `Key Contract Information
Campaign: Inflow UGC - Finance & Fintech
Per-post compensation: $35.00 per approved deliverable.
Bonuses (per Deliverable):
50000 views: $50.00
Only views accrued within 30 days of upload are counted.
A payment cycle completes when 60 deliverables are approved.`

function resultWith(fields: ParseResult['fields']): ParseResult {
  return {
    campaign: { name: 'Inflow', company: 'Inflowpay', approval_mode: 'video' },
    fields,
    bonus_tiers: [],
    rules: [],
    brief_is_incomplete: false,
    warnings: [],
  }
}

describe('the vendored Edge Function copy matches the client verifier', () => {
  const cases: Array<{ name: string; fields: ParseResult['fields']; briefText?: string | null }> = [
    {
      name: 'a quote present verbatim',
      fields: {
        pay_per_video_cents: {
          value: '3500',
          source_quote: '$35.00 per approved deliverable',
          from: 'contract',
        },
      },
    },
    {
      name: 'a plausible but fabricated quote',
      fields: {
        pay_per_video_cents: {
          value: '5000',
          source_quote: '$50.00 per approved deliverable',
          from: 'contract',
        },
      },
    },
    {
      name: 'no quote at all',
      fields: { submission_url: { value: 'https://sideshift.app/submit', source_quote: null } },
    },
    {
      name: 'whitespace-damaged but real quote',
      fields: {
        cycle_size: {
          value: '60',
          source_quote: 'A payment cycle completes\n  when 60 deliverables',
          from: 'contract',
        },
      },
    },
    {
      name: 'quote real but attributed to the wrong document',
      fields: {
        platforms: { value: 'TikTok', source_quote: 'Per-post compensation', from: 'brief' },
      },
      briefText: 'A brief that says nothing of the sort.',
    },
    {
      name: 'already-absent field',
      fields: { submission_url: { value: null, source_quote: null } },
    },
  ]

  for (const { name, fields, briefText = null } of cases) {
    it(`verifyQuotes agrees on: ${name}`, () => {
      const documents = { briefText, contractText: CONTRACT }
      const client = clientVerifyQuotes(resultWith(fields), documents)
      const vendored = vendoredVerifyQuotes(resultWith(fields), documents)
      expect(vendored).toEqual(client)
    })
  }

  const briefs = [
    `## 1. Product\nText.\n## 2. Audience\nText.\n## 3. Rules\nText.`,
    `## 1. Product\nText.\n## 2. Audience\nText.\n## 4. Rules\nText.`,
    `## 1. Product\nSee section 6 for the never-do list.\n## 2. Audience\nText.`,
    'Just prose, no headings anywhere.',
  ]

  for (const brief of briefs) {
    it(`inspectBrief agrees on: ${JSON.stringify(brief.slice(0, 30))}...`, () => {
      expect(vendoredInspectBrief(brief)).toEqual(clientInspectBrief(brief))
    })
  }
})
