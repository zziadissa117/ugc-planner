// One real generation against the deployed generate-hooks function.
//
// Everything else is covered without the network: hookPromptDriftGuard proves
// the vendored prompt matches the client's, and the rotation and assembly are
// pure functions tested there. What only a real call can prove is that the
// function is reachable, that ANTHROPIC_API_KEY is set as a project secret,
// that a real model call comes back in the shape the schema asks for, and -
// the part that actually matters - that hooks generated from a campaign's own
// material do not invent facts or break its never-do list.
//
// Excluded from the default suite: it needs the network, a real session, and
// spends a small amount of money per run. Run it with `npm run test:live`.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { GenerateHooksResult, HookContext } from './hookPrompt'

const URL = import.meta.env.VITE_SUPABASE_URL as string
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

const PASSWORD = 'Hooks-live-test-password-12345!'
const email = `hooks-live-${Date.now()}@ugcplanner.app`

/** Inflow's real material, as the app stores it. The point of using the real
 *  thing is that the never-do list has rules a generator would plausibly
 *  break - naming a competitor, promising tax escape - so "it obeyed" means
 *  something. */
const CONTEXT: HookContext = {
  campaignName: 'Inflow',
  company: 'Inflowpay',
  productFacts:
    'Inflow is a payment system for people who sell online: paid instantly, from anywhere, at one flat price of 4% + $0.35 all inclusive, with sales taxes collected and filed because Inflow is the official seller on the transaction. No country restrictions. Real humans 7 days a week. One-click integration.',
  audience:
    'Online store owners 25-45 selling internationally and running ads. They scroll past anything that smells like an ad.',
  tone: 'Talk like a person telling a friend something useful. Concrete over clever.',
  structure: 'Hook, then the problem, then Inflow as what fixed it, then a concrete number.',
  rules: [
    'Never promise anyone escapes, avoids or hides from taxes.',
    'Never name or attack a competitor. Say "your payment processor" or "most processors".',
    'Never mix more than one angle into a video.',
    'Never say "Inflow" more than once.',
  ],
  angles: [
    { id: 'angle-frozen', label: 'A. Frozen funds', body: 'Accounts freeze when a business takes off.', family: 'fear' },
    { id: 'angle-waiting', label: 'B. Waiting for your own money', body: 'The sale clears in 3 seconds, the payout takes 7 days.', family: 'fear' },
    { id: 'angle-rate', label: 'E. The real rate', body: 'An advertised 2.5-2.9% becomes well past 4%.', family: 'greed' },
  ],
  lastFamily: 'fear',
  count: 4,
}

let client: SupabaseClient

beforeAll(async () => {
  client = createClient(URL, KEY, { auth: { persistSession: false } })
  const { error } = await client.auth.signUp({ email, password: PASSWORD })
  if (error) throw new Error(`signUp failed: ${error.message}`)
})

afterAll(async () => {
  await client.auth.signOut()
})

describe('the deployed generate-hooks function', () => {
  it('refuses a call with no session', async () => {
    const response = await fetch(`${URL}/functions/v1/generate-hooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(CONTEXT),
    })
    expect(response.status).toBe(401)
  })

  it('refuses a request with no campaign name', async () => {
    // A malformed context must not reach the prompt and be answered with
    // confident nonsense built on the string "undefined". supabase-js reports
    // a non-2xx as `error` with a null body, so that is what is checked.
    const { data, error } = await client.functions.invoke('generate-hooks', {
      body: { count: 3 },
    })
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  it('writes hooks from the campaign material, obeying its never-do list', async () => {
    const { data, error } = await client.functions.invoke('generate-hooks', { body: CONTEXT })
    expect(error).toBeNull()

    const result = data as GenerateHooksResult
    expect(result.hooks.length).toBeGreaterThan(0)

    const known = new Set(CONTEXT.angles.map((angle) => angle.id))
    for (const hook of result.hooks) {
      expect(hook.body.trim()).not.toBe('')
      // Never an invented angle id: it would break the foreign key, and filing
      // a hook under a storyline nobody chose is worse than filing it under
      // none.
      if (hook.angle_id !== null) expect(known.has(hook.angle_id)).toBe(true)
    }

    const all = result.hooks.map((hook) => hook.body).join(' ').toLowerCase()

    // The never-do list, checked where it can be checked mechanically. Naming
    // a competitor is the rule most likely to be broken by a model reaching
    // for a concrete comparison.
    for (const competitor of ['stripe', 'paypal', 'shopify payments', 'wise', 'payoneer']) {
      expect(all).not.toContain(competitor)
    }

    // "Escape" applies to fees, freezes and waiting - never to taxes.
    expect(all).not.toMatch(/(avoid|escape|dodge|skip|hide from)\s+(the\s+)?tax/)
  })
})
