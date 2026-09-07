// Not an assertion - a window onto what the generator actually writes.
//
// The other live test proves the round trip works and that the rules that can
// be checked mechanically were kept. Whether the hooks are any GOOD is a
// judgement, and judging them needs seeing them. This prints a batch so they
// can be read, and asserts only the floor: that something came back.
//
// Run with `npm run test:live -- src/hooks/inspectHooks.live.test.ts`.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { GenerateHooksResult, HookContext } from './hookPrompt'

const URL = import.meta.env.VITE_SUPABASE_URL as string
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

const PASSWORD = 'Hooks-inspect-password-12345!'
const email = `hooks-inspect-${Date.now()}@ugcplanner.app`

const CONTEXT: HookContext = {
  campaignName: 'Inflow',
  company: 'Inflowpay',
  productFacts:
    'Inflow is a payment system for people who sell online: paid instantly, from anywhere, at one flat price of 4% + $0.35 all inclusive, with sales taxes collected and filed because Inflow is the official seller on the transaction. No country restrictions. Real humans 7 days a week. One-click integration.',
  audience:
    'Online store owners 25-45 selling internationally and running ads; creators and digital sellers; people running a business while living abroad. They scroll past anything that smells like an ad.',
  tone: 'Talk like a person telling a friend something useful. Concrete over clever. Annoyed, surprised or relieved is good; flat delivery kills the video.',
  structure:
    'Hook (0-2 sec), then the problem / that-is-me moment, then Inflow introduced naturally as what fixed it, then a payoff with a concrete number.',
  rules: [
    'Never promise anyone escapes, avoids or hides from taxes. "Escape" applies to fees, freezes and waiting, never to taxes.',
    'Never name or attack a competitor. Say "your payment processor" or "most processors".',
    'Never mix more than one angle into a video.',
    'Never say "Inflow" more than once, and never during warm-up.',
    'Numbers exactly as written: 4% + $0.35, instant payouts.',
  ],
  angles: [
    { id: 'angle-frozen', label: 'A. Frozen funds', body: 'A good month looks like fraud to an algorithm; accounts freeze exactly when a business takes off.', family: 'fear' },
    { id: 'angle-waiting', label: 'B. Waiting for your own money', body: 'The sale clears in 3 seconds, the payout takes 7 days.', family: 'fear' },
    { id: 'angle-country', label: 'C. Your country is not supported', body: 'Rejected for a passport or an address, not for anything about the business.', family: 'fear' },
    { id: 'angle-rate', label: 'E. The real rate', body: 'An advertised 2.5-2.9% becomes well past 4% once international cards, conversion and chargebacks stack.', family: 'greed' },
    { id: 'angle-user', label: 'F. You use it too', body: 'Speak as an actual user, not as an ad.', family: 'greed' },
  ],
  referenceMaterial: [],
  lastFamily: 'fear',
  count: 6,
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

describe('what the generator actually writes', () => {
  it('prints a batch for a human to judge', async () => {
    const { data, error } = await client.functions.invoke('generate-hooks', { body: CONTEXT })
    expect(error).toBeNull()

    const result = data as GenerateHooksResult
    const byId = new Map(CONTEXT.angles.map((angle) => [angle.id, angle]))

    const lines: string[] = ['', '--- generated hooks ---']
    for (const hook of result.hooks) {
      const angle = hook.angle_id === null ? null : byId.get(hook.angle_id)
      const label = angle ? `${angle.label} [${angle.family}]` : 'no angle'
      lines.push('')
      lines.push(`(${label})`)
      lines.push(`  ${hook.body}`)
      if (hook.outline !== null) lines.push(`  -> ${hook.outline}`)
    }
    if (result.warnings.length > 0) {
      lines.push('')
      lines.push(`warnings: ${result.warnings.join(' | ')}`)
    }
    lines.push('')
    console.log(lines.join('\n'))

    expect(result.hooks.length).toBeGreaterThan(0)
  })
})
