// A parse with the same bonus threshold twice, or the same rule twice, saves
// once rather than refusing the whole campaign with Dexie's own words.

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { applyParseResult } from './apply'
import type { ParseResult } from './types'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: LocalAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`apply-dedupe-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})

const RESULT: ParseResult = {
  campaign: { name: 'Playad', company: null, approval_mode: null },
  fields: {},
  // A bonus table per platform: the same tier read twice.
  bonus_tiers: [
    { label: '50k views', threshold_views: 50_000, payout_cents: 5000, view_window_days: null, source_quote: '50k views: $50', from: 'contract' },
    { label: '50k views (TikTok)', threshold_views: 50_000, payout_cents: 5000, view_window_days: null, source_quote: '50k views: $50', from: 'contract' },
    { label: '100k views', threshold_views: 100_000, payout_cents: 10000, view_window_days: null, source_quote: '100k views: $100', from: 'contract' },
  ],
  rules: [
    { body: 'No competitor logos.', source_quote: 'No competitor logos.', from: 'brief' },
    { body: 'no competitor   logos.', source_quote: 'No competitor logos.', from: 'contract' },
    { body: 'Disclose the partnership.', source_quote: 'Disclose the partnership.', from: 'contract' },
  ],
  brief_is_incomplete: false,
  warnings: [],
}

describe('applying a parse with repeats in it', () => {
  it('keeps each tier and each rule once, and saves the campaign', async () => {
    const campaign = await applyParseResult(adapter, {
      result: RESULT,
      confirmed: new Set(),
      briefText: 'No competitor logos.',
      briefFilename: null,
      contractText: '50k views: $50\n100k views: $100\nNo competitor logos.\nDisclose the partnership.',
      contractFilename: null,
    })
    const tiers = await adapter.listBonusTiers(campaign.id)
    expect(tiers.map((t) => t.threshold_views)).toEqual([50_000, 100_000])
    const rules = await adapter.listCampaignRules(campaign.id)
    expect(rules.map((r) => r.body)).toEqual(['No competitor logos.', 'Disclose the partnership.'])
  })
})
