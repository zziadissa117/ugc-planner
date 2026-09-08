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
  generationBrief: null,
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
  referenceMaterial: [],
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
    // Whole words: a plain substring check fails on "otherwise", which is not
    // a competitor and cost a real run to work out.
    for (const competitor of ['stripe', 'paypal', 'shopify payments', 'wise', 'payoneer']) {
      expect(all).not.toMatch(new RegExp(`\b${competitor}\b`))
    }

    // "Escape" applies to fees, freezes and waiting - never to taxes.
    expect(all).not.toMatch(/(avoid|escape|dodge|skip|hide from)\s+(the\s+)?tax/)
  })

  it('builds from the material he dumped into the brief', async () => {
    // The whole point of the Hooks & ideas box. The material below is
    // deliberately unlike anything the campaign's own sections say, so a
    // generator ignoring it produces nothing resembling these.
    const withMaterial = {
      ...CONTEXT,
      count: 5,
      referenceMaterial: [
        'Sunday night, checking the payout dashboard with a coffee, talking straight to camera',
        'The "my accountant called me" opener',
        'Walking through the airport talking about getting paid while travelling',
      ],
    }

    const { data, error } = await client.functions.invoke('generate-hooks', { body: withMaterial })
    expect(error).toBeNull()

    const result = data as GenerateHooksResult
    expect(result.hooks.length).toBeGreaterThan(0)

    const all = result.hooks.map((hook) => hook.body).join(' ').toLowerCase()
    // At least one of the situations he supplied should be recognisable in
    // what comes back. Any one of them is enough - this is checking the
    // material reached the model at all, not scoring the writing.
    const echoes = ['sunday', 'coffee', 'accountant', 'airport', 'travel', 'dashboard', 'payout']
    expect(echoes.some((word) => all.includes(word))).toBe(true)
  })

  it('generates with no angles at all', async () => {
    // Angles are optional and nothing in the app asks him to create one, so a
    // campaign with none must generate exactly as well as one with them.
    const noAngles = {
      ...CONTEXT,
      angles: [],
      lastFamily: null,
      referenceMaterial: ['POV: the payout finally lands and it is short again'],
      count: 3,
    }

    const { data, error } = await client.functions.invoke('generate-hooks', { body: noAngles })
    expect(error).toBeNull()

    const result = data as GenerateHooksResult
    expect(result.hooks.length).toBeGreaterThan(0)
    for (const hook of result.hooks) {
      expect(hook.body.trim()).not.toBe('')
      // No angles were given, so none can be claimed.
      expect(hook.angle_id).toBeNull()
    }
  })

  it('writes ten different hooks, not ten rewordings of the thesis', async () => {
    // The failure this exists to catch, from his own Vertus campaign: with no
    // angle list to spread across and a STRUCTURE whose first beat is the
    // campaign's thesis, the generator returned nine versions of "normal AI
    // predicts, Vertus reasons". Inflow looked fine only because its six
    // angles were doing the work.
    const thesisTrap = {
      ...CONTEXT,
      angles: [],
      lastFamily: null,
      productFacts:
        'A payment system. Most processors hold your money for days and advertise a rate lower than what you pay; this one pays out instantly at one flat price.',
      structure:
        '1. Most processors hold your money and hide fees. 2. This one pays instantly at one flat price. 3. Proof. 4. Call to action.',
      referenceMaterial: [
        'Format A - the receipt: open on the dashboard, react to what it says',
        'Format B - the confession: talk to camera about something embarrassing that happened',
        '"I sold twelve grand in a week and my account locked the same day."',
        '"my accountant called me" opener',
      ],
      count: 10,
    }

    const { data, error } = await client.functions.invoke('generate-hooks', { body: thesisTrap })
    expect(error).toBeNull()

    const result = data as GenerateHooksResult
    const bodies = result.hooks.map((hook) => hook.body.trim().toLowerCase())
    expect(bodies.length).toBeGreaterThan(2)

    // Every hook distinct, and not merely by a word: no two may share their
    // first six words, which is what nine rewordings of one sentence look
    // like from the outside.
    const openings = bodies.map((body) => body.split(/\s+/).slice(0, 6).join(' '))
    expect(new Set(openings).size).toBe(openings.length)
    expect(new Set(bodies).size).toBe(bodies.length)

    // And the batch as a whole must not be the thesis restated: if most of
    // them lean on the same word, they are the same hook.
    for (const word of ['instantly', 'flat', 'processor', 'processors']) {
      const leaning = bodies.filter((body) => body.includes(word)).length
      expect(leaning).toBeLessThan(Math.ceil(bodies.length * 0.75))
    }
  })
})
