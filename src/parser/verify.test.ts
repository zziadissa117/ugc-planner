// The check that catches fabrication mechanically instead of trusting the
// model to behave. A field survives only if the exact text it claims to come
// from is still findable in the document.

import { describe, expect, it } from 'vitest'

import type { ParseResult } from './types'
import { inspectBrief, valueIsInQuote, verifyQuotes } from './verify'

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

const verify = (fields: ParseResult['fields'], briefText: string | null = null) =>
  verifyQuotes(resultWith(fields), { briefText, contractText: CONTRACT })

describe('quote verification', () => {
  it('keeps a field whose quote is in the document', () => {
    const { result, rejected } = verify({
      pay_per_video_cents: {
        value: '3500',
        source_quote: '$35.00 per approved deliverable',
        from: 'contract',
      },
    })

    expect(rejected).toEqual([])
    expect(result.fields.pay_per_video_cents.value).toBe('3500')
  })

  it('blanks a field whose quote is nowhere in the document', () => {
    const { result, rejected } = verify({
      pay_per_video_cents: {
        // Plausible, well-formatted, and not in the contract.
        value: '5000',
        source_quote: '$50.00 per approved deliverable',
        from: 'contract',
      },
    })

    expect(rejected).toEqual(['pay_per_video_cents'])
    expect(result.fields.pay_per_video_cents.value).toBeNull()
    expect(result.fields.pay_per_video_cents.source_quote).toBeNull()
  })

  it('blanks a field that came back with no quote at all', () => {
    const { result, rejected } = verify({
      submission_url: { value: 'https://sideshift.app/submit', source_quote: null },
    })

    expect(rejected).toEqual(['submission_url'])
    expect(result.fields.submission_url.value).toBeNull()
  })

  it('keeps the key visible so a dropped field reads as a gap, not an absence', () => {
    const { result } = verify({
      cycle_size: { value: '999', source_quote: 'not in here', from: 'contract' },
    })

    // The row is still on the review screen, blank, rather than vanishing as
    // though nobody had tried.
    expect(Object.keys(result.fields)).toContain('cycle_size')
  })

  it('forgives whitespace and conversion damage but not different words', () => {
    const survives = verify({
      cycle_size: {
        // Soft-wrapped mid-sentence, as a PDF conversion leaves it.
        value: '60',
        source_quote: 'A payment cycle completes\n  when 60 deliverables',
        from: 'contract',
      },
    })
    expect(survives.rejected).toEqual([])

    const rejectedResult = verify({
      cycle_size: {
        value: '90',
        source_quote: 'A payment cycle completes when 90 deliverables',
        from: 'contract',
      },
    })
    expect(rejectedResult.rejected).toEqual(['cycle_size'])
  })

  it('checks the named document rather than any document', () => {
    const { rejected } = verifyQuotes(
      resultWith({
        platforms: {
          value: 'TikTok',
          // The words exist, but in the contract, not the brief it claims.
          source_quote: 'Per-post compensation',
          from: 'brief',
        },
      }),
      { briefText: 'A brief that says nothing of the sort.', contractText: CONTRACT },
    )
    expect(rejected).toEqual(['platforms'])
  })

  it('leaves an already-absent field alone', () => {
    const { result, rejected } = verify({
      submission_url: { value: null, source_quote: null },
    })
    expect(rejected).toEqual([])
    expect(result.fields.submission_url.value).toBeNull()
  })

  it('says how many it dropped', () => {
    const { result } = verify({
      a: { value: '1', source_quote: 'nope', from: 'contract' },
      b: { value: '2', source_quote: 'also nope', from: 'contract' },
    })
    expect(result.warnings.join(' ')).toContain('2 fields were dropped')
  })
})

describe('spotting a damaged brief', () => {
  it('accepts a brief whose sections run in order', () => {
    const brief = `## 1. Product
Text.
## 2. Audience
Text.
## 3. Rules
Text.`
    expect(inspectBrief(brief).isIncomplete).toBe(false)
  })

  it('notices a heading that did not survive conversion', () => {
    const brief = `## 1. Product
Text.
## 2. Audience
Text.
## 4. Rules
Text.`
    const integrity = inspectBrief(brief)
    expect(integrity.isIncomplete).toBe(true)
    expect(integrity.reasons.join(' ')).toContain('Section 3')
  })

  it('notices a cross-reference pointing at text that is not there', () => {
    const brief = `## 1. Product
See section 6 for the never-do list.
## 2. Audience
Text.`
    const integrity = inspectBrief(brief)
    expect(integrity.isIncomplete).toBe(true)
    expect(integrity.reasons.join(' ')).toContain('section 6')
  })

  it('does not crash on OCR garbage', () => {
    const brief = '~~~ \x00 ### 4.4.4 ((( ' + '�'.repeat(200)
    expect(() => inspectBrief(brief)).not.toThrow()
  })

  it('reads a brief with no numbered sections as intact rather than broken', () => {
    // Unable to tell is not the same as damaged, and crying wolf here would
    // train him to ignore the warning that matters.
    expect(inspectBrief('Just prose, no headings anywhere.').isIncomplete).toBe(false)
  })
})

describe('never-do rules need a quote too', () => {
  const BRIEF = 'Never name or attack a competitor. Say "your payment processor" instead.'
  const withRules = (rules: ParseResult['rules']) =>
    verifyQuotes({ ...resultWith({}), rules }, { briefText: BRIEF, contractText: CONTRACT })

  it('keeps a rule whose quote is in a document', () => {
    const { result, rejectedRules } = withRules([
      { body: 'Never name a competitor.', source_quote: 'Never name or attack a competitor', from: 'brief' },
    ])
    expect(result.rules).toHaveLength(1)
    expect(rejectedRules).toEqual([])
  })

  it('drops a rule nobody wrote down, and says so', () => {
    // It used to be written straight to the campaign as verified.
    const { result, rejectedRules } = withRules([
      { body: 'Never film outdoors.', source_quote: 'Never film outdoors' },
    ])
    expect(result.rules).toEqual([])
    expect(rejectedRules).toEqual(['Never film outdoors.'])
    expect(result.warnings.join(' ')).toMatch(/never-do rule was dropped/)
  })

  it('drops a rule with no quote at all', () => {
    const { result } = withRules([{ body: 'Never name a competitor.', source_quote: null }])
    expect(result.rules).toEqual([])
  })

  it('drops a rule quoting the wrong document', () => {
    const { result } = withRules([
      { body: 'Never name a competitor.', source_quote: 'Never name or attack a competitor', from: 'contract' },
    ])
    expect(result.rules).toEqual([])
  })
})

describe('bonus tiers are money, and get the strictest check', () => {
  const withTiers = (bonus_tiers: ParseResult['bonus_tiers']) =>
    verifyQuotes({ ...resultWith({}), bonus_tiers }, { briefText: null, contractText: CONTRACT })

  const tier = (over: Partial<ParseResult['bonus_tiers'][number]> = {}) => ({
    label: '50k',
    threshold_views: 50000,
    payout_cents: 5000,
    view_window_days: 30,
    source_quote: '50000 views: $50.00',
    from: 'contract' as const,
    ...over,
  })

  it('keeps a tier whose line is in the contract and states both numbers', () => {
    const { result, rejectedTiers } = withTiers([tier()])
    expect(result.bonus_tiers).toHaveLength(1)
    expect(result.bonus_tiers[0].view_window_days).toBe(30)
    expect(rejectedTiers).toEqual([])
  })

  it('drops a tier whose payout is not in its own line', () => {
    // The line is real; the $100 beside it was invented.
    const { result, rejectedTiers } = withTiers([tier({ payout_cents: 10000 })])
    expect(result.bonus_tiers).toEqual([])
    expect(rejectedTiers).toEqual(['50k'])
  })

  it('drops a tier whose view count is not in its own line', () => {
    const { result } = withTiers([tier({ threshold_views: 100000 })])
    expect(result.bonus_tiers).toEqual([])
  })

  it('drops a tier with no quote', () => {
    const { result } = withTiers([tier({ source_quote: null })])
    expect(result.bonus_tiers).toEqual([])
  })

  it('reads the ways contracts write numbers', () => {
    const contract = 'Bonuses: 1.5M views: $1,500.00. 100k views - $100'
    const { result } = verifyQuotes(
      {
        ...resultWith({}),
        bonus_tiers: [
          tier({ threshold_views: 1_500_000, payout_cents: 150_000, source_quote: '1.5M views: $1,500.00', view_window_days: null }),
          tier({ threshold_views: 100_000, payout_cents: 10_000, source_quote: '100k views - $100', view_window_days: null }),
        ],
      },
      { briefText: null, contractText: contract },
    )
    expect(result.bonus_tiers).toHaveLength(2)
  })

  it('blanks a view window no document mentions, rather than keeping a guess', () => {
    const { result } = withTiers([tier({ view_window_days: 45 })])
    expect(result.bonus_tiers).toHaveLength(1)
    expect(result.bonus_tiers[0].view_window_days).toBeNull()
  })
})

describe('whether a value can be read straight off its quote', () => {
  it('matches a rate in cents against the dollars in the line', () => {
    expect(valueIsInQuote('3500', '$35.00 per approved deliverable', 'money')).toBe(true)
    expect(valueIsInQuote('3000', '$35.00 per approved deliverable', 'money')).toBe(false)
  })

  it('matches a count against the numbers in the line', () => {
    expect(valueIsInQuote('60', 'completes when 60 deliverables', 'count')).toBe(true)
    expect(valueIsInQuote('90', 'completes when 60 deliverables', 'count')).toBe(false)
  })

  it('treats text as literal when it is a substring of the quote', () => {
    expect(valueIsInQuote('TikTok, Instagram', 'Required platforms: TikTok, Instagram.', 'text')).toBe(true)
    expect(valueIsInQuote('A payment app for sellers', 'Inflow is a payment system for people who sell online', 'text')).toBe(false)
  })
})
