// The client's hook prompt and the Edge Function's vendored copy must agree.
//
// The function runs on Deno and cannot import from src/, so the module is
// copied. Two copies of a prompt drift silently: the version that decides what
// the console tells him ("next: greed") stops being the version that decides
// what is actually asked for, and nothing fails - it just quietly generates the
// wrong thing.
//
// So both are imported here and run against the same inputs. If this fails,
// the fix is to re-copy src/hooks/hookPrompt.ts over the vendored file - never
// to special-case the vendored copy until it passes.

import { describe, expect, it } from 'vitest'

import * as client from './hookPrompt'
import * as vendored from '../../supabase/functions/_shared/hookPrompt'

const ANGLES: client.HookAngle[] = [
  { id: 'a1', label: 'A. Frozen funds', body: 'Accounts freeze when a business takes off.', family: 'fear' },
  { id: 'a2', label: 'E. The real rate', body: 'The advertised rate is not the real one.', family: 'greed' },
  { id: 'a3', label: 'B. Waiting for your own money', body: null, family: 'fear' },
]

const CONTEXT: client.HookContext = {
  campaignName: 'Inflow',
  company: 'Inflowpay',
  productFacts: 'A payment system: paid instantly, one flat price.',
  audience: 'Online store owners selling internationally.',
  tone: 'Talk like a person telling a friend something useful.',
  structure: 'Hook, then the problem, then what fixed it.',
  rules: ['Never name a competitor.', 'Never mix more than one angle into a video.'],
  angles: ANGLES,
  lastFamily: 'fear',
  count: 5,
}

describe('the vendored hook prompt matches the client', () => {
  it('agrees on the system prompt, verbatim', () => {
    expect(vendored.HOOK_SYSTEM_PROMPT).toEqual(client.HOOK_SYSTEM_PROMPT)
  })

  it('agrees on the tool schema', () => {
    expect(vendored.RETURN_HOOKS_SCHEMA).toEqual(client.RETURN_HOOKS_SCHEMA)
  })

  it('builds the same request from the same campaign', () => {
    expect(vendored.buildHookRequest(CONTEXT)).toEqual(client.buildHookRequest(CONTEXT))
  })

  it('agrees on which family comes next, from every starting point', () => {
    // This is the one that matters most: the console labels the next batch
    // using the client copy, and the prompt asks for it using the vendored
    // one. If they disagree the app says one thing and requests another.
    for (const last of ['fear', 'greed', 'FEAR', 'unknown', null]) {
      expect(vendored.nextFamily(ANGLES, last)).toEqual(client.nextFamily(ANGLES, last))
    }
  })

  it('agrees on the families a campaign has', () => {
    expect(vendored.familiesOf(ANGLES)).toEqual(client.familiesOf(ANGLES))
  })

  it('drops unknown angle ids the same way', () => {
    const result = {
      hooks: [
        { body: 'Known.', outline: null, angle_id: 'a1' },
        { body: 'Invented.', outline: null, angle_id: 'nope' },
        { body: 'None.', outline: null, angle_id: null },
      ],
      warnings: [],
    }
    expect(vendored.dropUnknownAngles(result, ANGLES)).toEqual(
      client.dropUnknownAngles(result, ANGLES),
    )
  })
})

describe('the rotation rule itself', () => {
  it('alternates away from the family last used', () => {
    expect(client.nextFamily(ANGLES, 'fear')).toBe('greed')
    expect(client.nextFamily(ANGLES, 'greed')).toBe('fear')
  })

  it('ignores the case he happened to type', () => {
    expect(client.nextFamily(ANGLES, 'FEAR')).toBe('greed')
  })

  it('has no preference when a brief does not split its angles', () => {
    // Not every brief has families, and inventing a taxonomy to have an answer
    // would be exactly the kind of guess the app refuses to make.
    const unfamilied = ANGLES.map((angle) => ({ ...angle, family: null }))
    expect(client.nextFamily(unfamilied, null)).toBeNull()
    expect(client.nextFamily(unfamilied, 'fear')).toBeNull()
  })

  it('starts somewhere sensible when nothing has been filmed yet', () => {
    expect(client.nextFamily(ANGLES, null)).toBe('fear')
  })
})

describe('what the model is allowed to see', () => {
  it('says a section is not saved rather than filling it in', () => {
    const thin = { ...CONTEXT, productFacts: null, audience: null, rules: [] }
    const request = client.buildHookRequest(thin)

    expect(request).toContain('(not saved yet)')
    // The prompt has to carry the absence, not paper over it: this text is
    // about to become a video that goes to a brand.
    expect(request).not.toContain('undefined')
    expect(request).not.toContain('null')
  })

  it('passes the never-do list as rules, and every angle with its id', () => {
    const request = client.buildHookRequest(CONTEXT)

    expect(request).toContain('NEVER DO')
    expect(request).toContain('Never name a competitor.')
    for (const angle of ANGLES) expect(request).toContain(angle.id)
  })

  it('asks for the number he actually set', () => {
    expect(client.buildHookRequest({ ...CONTEXT, count: 9 })).toContain('Write 9 hooks.')
  })
})
