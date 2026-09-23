// One real drop-box parse against the deployed parse-campaign function.
//
// Everything else about this function is covered without the network:
// edgeFunctionVerify.driftGuard.test.ts proves the vendored verifyQuotes
// matches the client's, and docs/EDGE_FUNCTION.md's contract is what the
// handler was written against. What only a real call can prove is the part
// that cannot be unit-tested: that the deployed function is reachable, that
// ANTHROPIC_API_KEY is actually set as a project secret, that a real model
// call comes back in the expected shape, and that the whole round trip -
// auth, model, quote verification - produces a result the review screen could
// actually render.
//
// Excluded from the default suite - it needs the network, a real session, and
// spends a small amount of money per run. Run it with `npm run test:live`.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { NEVER_PARSED_FIELDS } from './types'

const URL = import.meta.env.VITE_SUPABASE_URL as string
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

const PASSWORD = 'Parse-live-test-password-12345!'
const stamp = Date.now()
const email = `parse-live-${stamp}@ugcplanner.app`

// Templated the way a real SideShift contract is, per docs/EDGE_FUNCTION.md's
// anchor table - this is what "parse with high confidence" is checked against.
const CONTRACT = `Key Contract Information
Campaign: Inflow UGC - Finance & Fintech
Company: Inflowpay Inc.
Per-post compensation: $35.00 per approved deliverable.
Required platforms: TikTok, Instagram.
Bonuses (per Deliverable):
50000 views: $50.00
Only views accrued within 30 days of upload are counted.
A payment cycle completes when 60 deliverables are approved, to a maximum of 60 posts per payment cycle.
Once a deliverable is posted, do not delete, hide, or restrict it for a period of 90 days.`

let client: SupabaseClient

beforeAll(async () => {
  client = createClient(URL, KEY, { auth: { persistSession: false } })
  const { error } = await client.auth.signUp({ email, password: PASSWORD })
  if (error) throw new Error(`signUp failed: ${error.message}`)
})

afterAll(async () => {
  await client.auth.signOut()
})

describe('the deployed parse-campaign function', () => {
  it('rejects a call with no Authorization at all', async () => {
    const anon = createClient(URL, KEY, { auth: { persistSession: false } })
    const { data, error } = await anon.functions.invoke('parse-campaign', {
      body: { briefText: null, contractText: CONTRACT },
      headers: { Authorization: '' },
    })
    // supabase-js still sends the apikey header even with an empty override,
    // so what this actually proves is verify_jwt's own check: no bearer user
    // token means no result and no fabricated stand-in for one.
    expect(data).toBeNull()
    expect(error).not.toBeNull()
  })

  it('parses a real contract end to end - auth, model, quote verification', async () => {
    const { data, error } = await client.functions.invoke('parse-campaign', {
      body: { briefText: null, contractText: CONTRACT },
    })

    expect(error).toBeNull()
    expect(data).not.toBeNull()

    const result = data as {
      campaign: { name: string; company: string | null }
      fields: Record<string, { value: string | null; source_quote: string | null }>
      warnings: string[]
    }

    // The one field this contract states in the exact anchor form the prompt
    // is told to trust. If this comes back wrong, the deployment is broken in
    // a way none of the offline tests can see.
    expect(result.fields.pay_per_video_cents?.value).toBe('3500')
    expect(result.fields.pay_per_video_cents?.source_quote).toBeTruthy()
    expect(CONTRACT.toLowerCase()).toContain(
      result.fields.pay_per_video_cents!.source_quote!.toLowerCase(),
    )

    // Never-parsed fields are stripped server-side no matter what the model
    // tried to return.
    for (const key of NEVER_PARSED_FIELDS) {
      expect(result.fields[key]).toBeUndefined()
    }

    // Every surviving field actually carries a quote - the mechanical check,
    // not a trust exercise, running against a real model response.
    for (const [key, field] of Object.entries(result.fields)) {
      if (field.value !== null) {
        expect(field.source_quote, `${key} had a value with no quote`).toBeTruthy()
      }
    }
  }, 120_000)

  it('quotes its rules and bonus tiers, and says which model answered', async () => {
    const brief = [
      '## 3. Rules',
      '- Never name or attack a competitor. Say "your payment processor" or "most processors".',
      '- No filters or built-in camera effects.',
      '- Every Inflow video carries #ad and tags @inflowpay.',
      '## 4. Product',
      'Inflow is a payment system for people who sell online: paid instantly, from anywhere, at one flat price of 4% + $0.35 all inclusive.',
    ].join('\n')

    const started = Date.now()
    const { data, error } = await client.functions.invoke('parse-campaign', {
      body: { briefText: brief, contractText: CONTRACT, version: 2 },
    })
    const seconds = (Date.now() - started) / 1000
    console.log(`parse-campaign answered in ${seconds.toFixed(1)}s`)

    expect(error).toBeNull()
    const result = data as {
      model: string
      rules: { body: string; source_quote: string }[]
      bonus_tiers: { threshold_views: number; payout_cents: number; source_quote: string }[]
      fields: Record<string, { value: string | null; source_quote: string | null; note?: string | null }>
    }
    console.log(`model: ${result.model}`)
    console.log(JSON.stringify({ rules: result.rules, tiers: result.bonus_tiers }, null, 2))

    expect(typeof result.model).toBe('string')
    expect(result.rules.length).toBeGreaterThanOrEqual(2)
    const both = `${brief}\n${CONTRACT}`.toLowerCase().replace(/\s+/g, ' ')
    for (const rule of result.rules) {
      expect(both).toContain(rule.source_quote.toLowerCase().replace(/\s+/g, ' '))
    }
    expect(result.bonus_tiers).toEqual([
      expect.objectContaining({ threshold_views: 50000, payout_cents: 5000 }),
    ])
    expect(result.fields.product_facts?.value).toBeTruthy()
  }, 120_000)
})
