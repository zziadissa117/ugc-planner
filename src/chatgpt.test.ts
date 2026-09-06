// The block he pastes into a model to generate a script from.
//
// The thing worth guarding here is what it does NOT say. An invented "hard
// rule" in this block becomes an invented rule in a video that goes to a
// brand, so every empty section has to read as empty.

import { describe, expect, it } from 'vitest'

import { buildChatGptBlock } from './chatgpt'
import type { Campaign, CampaignField, CampaignRule } from './data'

const USER = 'u'

const campaign = (overrides: Partial<Campaign> = {}): Campaign => ({
  id: 'c1',
  user_id: USER,
  name: 'Inflow',
  company: 'Inflowpay',
  is_active: true,
  approval_mode: 'video',
  default_setup: 'face',
  daily_post_quota: 1,
  pay_per_video_cents: 3500,
  cycle_size: 60,
  opening_post_count: 13,
  brief_is_incomplete: false,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  ...overrides,
})

const field = (key: string, value: string | null, source: CampaignField['source']): CampaignField => ({
  id: `f-${key}`,
  user_id: USER,
  campaign_id: 'c1',
  field_key: key,
  field_value: value,
  source,
  source_quote: null,
  source_document_id: null,
  confirmed_at: null,
  updated_at: '2026-09-01T00:00:00.000Z',
})

const rule = (body: string): CampaignRule => ({
  id: `r-${body.slice(0, 8)}`,
  user_id: USER,
  campaign_id: 'c1',
  body,
  is_verified: true,
  sort_order: 1,
  updated_at: '2026-09-01T00:00:00.000Z',
})

describe('the ChatGPT block', () => {
  it('names the campaign and its company', () => {
    expect(buildChatGptBlock(campaign(), [], [])).toContain('CAMPAIGN: Inflow (Inflowpay)')
  })

  it('carries product, rules, structure and voice', () => {
    const block = buildChatGptBlock(
      campaign(),
      [
        field('product_facts', 'One flat price of 4% + $0.35.', 'user_entered'),
        field('structure', 'Hook, problem, payoff.', 'user_entered'),
        field('tone', 'Like telling a friend.', 'user_entered'),
        field('audience', 'Store owners 25-45.', 'user_entered'),
      ],
      [rule('Never promise anyone escapes taxes.')],
    )

    expect(block).toContain('One flat price of 4% + $0.35.')
    expect(block).toContain('- Never promise anyone escapes taxes.')
    expect(block).toContain('Hook, problem, payoff.')
    expect(block).toContain('Like telling a friend.')
    expect(block).toContain('Store owners 25-45.')
  })

  it('marks every empty section rather than filling it in', () => {
    const block = buildChatGptBlock(campaign(), [], [])

    expect(block).toContain('PRODUCT\n(not saved yet)')
    expect(block).toContain('HARD RULES - NEVER BREAK THESE\n(not saved yet)')
    expect(block).toContain('STRUCTURE\n(not saved yet)')
    expect(block).toContain('VOICE\n(not saved yet)')
  })

  it('treats a missing field as empty even though a row exists for it', () => {
    const block = buildChatGptBlock(
      campaign(),
      [field('structure', null, 'missing')],
      [],
    )
    expect(block).toContain('STRUCTURE\n(not saved yet)')
  })

  it('warns when the brief it came from is incomplete', () => {
    const block = buildChatGptBlock(
      campaign({ brief_is_incomplete: true }),
      [],
      [rule('Never name a competitor.')],
    )
    // He is about to generate a script against this list, so he should know it
    // may be short before he does.
    expect(block).toContain('this brief is incomplete')
  })

  it('says nothing about an incomplete brief when the brief is intact', () => {
    const block = buildChatGptBlock(campaign({ brief_is_incomplete: false }), [], [])
    expect(block).not.toContain('incomplete')
  })

  it('omits the technical section entirely when nothing is saved for it', () => {
    expect(buildChatGptBlock(campaign(), [], [])).not.toContain('TECHNICAL')
    expect(
      buildChatGptBlock(campaign(), [field('technical_spec', '9:16, 1080x1920.', 'user_entered')], []),
    ).toContain('TECHNICAL')
  })
})
