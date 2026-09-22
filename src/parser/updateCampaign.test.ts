// The rule this file exists to enforce: a field he already confirmed never
// changes without a tap. A new document can only propose a conflict, never
// resolve one, and everything additive (a rule, a bonus tier) is never a
// conflict at all - nothing already saved can be lost by adding something
// that was not there.

import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'

import type { BonusTier, CampaignField, CampaignRule } from '../data'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { applyCampaignUpdate, diffFields, newBonusTiers, newRules } from './updateCampaign'
import type { ParseResult } from './types'

function field(over: Partial<CampaignField> = {}): CampaignField {
  return {
    id: 'f1',
    user_id: 'u1',
    campaign_id: 'c1',
    field_key: 'pay_per_video_cents',
    field_value: '3500',
    source: 'documented',
    source_quote: '$35.00',
    source_document_id: null,
    confirmed_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function rule(over: Partial<CampaignRule> = {}): CampaignRule {
  return {
    id: 'r1',
    user_id: 'u1',
    campaign_id: 'c1',
    body: 'Never name a competitor.',
    is_verified: true,
    sort_order: 1,
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function tier(over: Partial<BonusTier> = {}): BonusTier {
  return {
    id: 't1',
    user_id: 'u1',
    campaign_id: 'c1',
    label: '50k views',
    threshold_views: 50000,
    payout_cents: 5000,
    view_window_days: 30,
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function parseResult(over: Partial<ParseResult> = {}): ParseResult {
  return {
    campaign: { name: 'Inflow', company: 'Inflowpay', approval_mode: 'none' },
    fields: {},
    bonus_tiers: [],
    rules: [],
    brief_is_incomplete: false,
    warnings: [],
    ...over,
  }
}

describe('diffFields', () => {
  it('is new when the campaign has no such field yet', () => {
    const result = parseResult({
      fields: { platforms: { value: 'TikTok, Instagram, YouTube', source_quote: 'Required platforms: TikTok, Instagram, YouTube' } },
    })
    const [diff] = diffFields([], {pay_per_video_cents: null, cycle_size: null}, result)
    expect(diff.status).toBe('new')
  })

  it('is same when the parsed value matches, ignoring spacing', () => {
    const current = field({ field_value: '3500' })
    const result = parseResult({
      fields: { pay_per_video_cents: { value: '3500', source_quote: '$35.00' } },
    })
    expect(diffFields([current], {pay_per_video_cents: null, cycle_size: null}, result)[0].status).toBe('same')
  })

  it('is a conflict when a confirmed value disagrees with the new one - never applied automatically', () => {
    const current = field({ field_value: '3500', source: 'documented' })
    const result = parseResult({
      fields: { pay_per_video_cents: { value: '4000', source_quote: '$40.00' } },
    })
    const [diff] = diffFields([current], {pay_per_video_cents: null, cycle_size: null}, result)
    expect(diff.status).toBe('conflict')
    expect(diff.current).toBe(current)
    expect(diff.parsedValue).toBe('4000')
  })

  it('treats a field that was only ever missing as new, not as a conflict', () => {
    const current = field({ field_value: null, source: 'missing' })
    const result = parseResult({
      fields: { submission_url: { value: 'https://sideshift.app/x', source_quote: 'submit at sideshift.app/x' } },
    })
    const [diff] = diffFields([current], {pay_per_video_cents: null, cycle_size: null}, result)
    expect(diff.status).toBe('new')
  })

  it('skips a field the new document does not mention at all', () => {
    const current = field()
    const result = parseResult({ fields: {} })
    expect(diffFields([current], {pay_per_video_cents: null, cycle_size: null}, result)).toEqual([])
  })

  it('skips a field the parser returned null for', () => {
    const result = parseResult({
      fields: { submission_url: { value: null, source_quote: null } },
    })
    expect(diffFields([], {pay_per_video_cents: null, cycle_size: null}, result)).toEqual([])
  })

  it('checks a changed rate against the campaign column when there is no field row for it', () => {
    // pay_per_video_cents is promoted straight onto the campaign row. A
    // campaign whose rate was set some other way than the normal parsed-and-
    // confirmed path - directly at creation, by an import - can have an
    // operating rate with no campaign_fields row behind it at all. Falling
    // back to "new" here would apply a changed, already-in-use rate without a
    // second thought - the exact silent overwrite this file exists to stop.
    const result = parseResult({
      fields: { pay_per_video_cents: { value: '4000', source_quote: '$40.00' } },
    })
    const [diff] = diffFields([], { pay_per_video_cents: 3500, cycle_size: null }, result)
    expect(diff.status).toBe('conflict')
    expect(diff.currentValue).toBe('3500')
  })

  it('is new when the column genuinely has no rate either', () => {
    const result = parseResult({
      fields: { pay_per_video_cents: { value: '4000', source_quote: '$40.00' } },
    })
    const [diff] = diffFields([], { pay_per_video_cents: null, cycle_size: null }, result)
    expect(diff.status).toBe('new')
  })

  it('prefers the field row over the column when both exist', () => {
    // The field row is what he actually confirmed; the column should always
    // agree with it via confirmFieldValue, but the row is the more direct
    // source of truth if they were ever to disagree.
    const current = field({ field_key: 'pay_per_video_cents', field_value: '3500' })
    const result = parseResult({
      fields: { pay_per_video_cents: { value: '3500', source_quote: '$35.00' } },
    })
    const [diff] = diffFields([current], { pay_per_video_cents: 9999, cycle_size: null }, result)
    expect(diff.status).toBe('same')
  })
})

describe('newRules', () => {
  it('keeps a rule the campaign does not already have', () => {
    const result = parseResult({ rules: [{ body: 'Every video carries #ad.', source_quote: 'Every video carries #ad.' }] })
    expect(newRules([], result)).toEqual(['Every video carries #ad.'])
  })

  it('drops one already present, even reworded with different spacing', () => {
    const current = rule({ body: 'Never  name   a competitor.' })
    const result = parseResult({ rules: [{ body: 'never name a competitor.', source_quote: 'never name a competitor.' }] })
    expect(newRules([current], result)).toEqual([])
  })

  it('never proposes removing a rule the new document left out', () => {
    // The function only ever returns additions - there is no "missing" side.
    const current = rule({ body: 'Keep posts public for 90 days.' })
    const result = parseResult({ rules: [] })
    expect(newRules([current], result)).toEqual([])
  })

  it('does not duplicate the same new rule twice in one document', () => {
    const result = parseResult({ rules: [{ body: 'Never name a competitor.', source_quote: 'Never name a competitor.' }, { body: 'Never name a competitor.', source_quote: 'Never name a competitor.' }] })
    expect(newRules([], result)).toEqual(['Never name a competitor.'])
  })
})

describe('newBonusTiers', () => {
  it('keeps a tier at a threshold the campaign does not have', () => {
    const current = tier({ threshold_views: 50000 })
    const result = parseResult({
      bonus_tiers: [{ label: '100k', threshold_views: 100000, payout_cents: 10000, view_window_days: 30, source_quote: null }],
    })
    expect(newBonusTiers([current], result)).toHaveLength(1)
  })

  it('drops one at a threshold already saved, so the schema unique constraint is never hit', () => {
    const current = tier({ threshold_views: 50000 })
    const result = parseResult({
      bonus_tiers: [{ label: '50k', threshold_views: 50000, payout_cents: 5000, view_window_days: 30, source_quote: null }],
    })
    expect(newBonusTiers([current], result)).toEqual([])
  })
})

describe('applyCampaignUpdate', () => {
  async function setUp() {
    const db = new LocalDatabase(`update-${crypto.randomUUID()}`)
    const adapter = new LocalAdapter(db, '11111111-1111-4111-8111-111111111111')
    await db.open()
    const campaign = await adapter.createCampaign({
      name: 'Inflow',
      company: 'Inflowpay',
      default_setup: 'face',
      approval_mode: 'none',
      pay_per_video_cents: 3500,
      cycle_size: 60,
    })
    await adapter.setCampaignField({
      campaign_id: campaign.id,
      field_key: 'pay_per_video_cents',
      field_value: '3500',
      source: 'parsed_unreviewed',
      source_quote: '$35.00',
      source_document_id: null,
    })
    // Only confirmCampaignField may promote to `documented` - this is his tap.
    await adapter.confirmCampaignField(campaign.id, 'pay_per_video_cents')
    await adapter.addCampaignRule({
      campaign_id: campaign.id,
      body: 'Never name a competitor.',
      is_verified: true,
      sort_order: 1,
    })
    return { adapter, campaign }
  }

  it('leaves a confirmed field untouched unless the conflict is explicitly accepted', async () => {
    const { adapter, campaign } = await setUp()
    const result = parseResult({
      fields: { pay_per_video_cents: { value: '4000', source_quote: '$40.00' } },
    })

    await applyCampaignUpdate(adapter, {
      campaignId: campaign.id,
      result,
      acceptedNewFieldKeys: new Set(),
      acceptedConflictFieldKeys: new Set(), // Nothing accepted - "Keep old".
      briefText: null,
      briefFilename: null,
      contractText: null,
      contractFilename: null,
    })

    const fields = await adapter.listCampaignFields(campaign.id)
    const rate = fields.find((f) => f.field_key === 'pay_per_video_cents')
    expect(rate?.field_value).toBe('3500')
    expect(rate?.source).toBe('documented')
  })

  it('writes a conflict as amber, not documented, even when he chooses the new value', async () => {
    const { adapter, campaign } = await setUp()
    const result = parseResult({
      fields: { pay_per_video_cents: { value: '4000', source_quote: '$40.00' } },
    })

    await applyCampaignUpdate(adapter, {
      campaignId: campaign.id,
      result,
      acceptedNewFieldKeys: new Set(),
      acceptedConflictFieldKeys: new Set(['pay_per_video_cents']), // "Use new".
      briefText: null,
      briefFilename: null,
      contractText: null,
      contractFilename: null,
    })

    const fields = await adapter.listCampaignFields(campaign.id)
    const rate = fields.find((f) => f.field_key === 'pay_per_video_cents')
    expect(rate?.field_value).toBe('4000')
    // A second parse deserves the same one-tap confirmation the first did,
    // even though he already decided he wants this value.
    expect(rate?.source).toBe('parsed_unreviewed')
  })

  it('writes a brand new field without needing a decision, since nothing is at risk', async () => {
    const { adapter, campaign } = await setUp()
    const result = parseResult({
      fields: { platforms: { value: 'TikTok, Instagram, YouTube', source_quote: 'Required platforms: TikTok, Instagram, YouTube' } },
    })

    await applyCampaignUpdate(adapter, {
      campaignId: campaign.id,
      result,
      acceptedNewFieldKeys: new Set(['platforms']),
      acceptedConflictFieldKeys: new Set(),
      briefText: null,
      briefFilename: null,
      contractText: null,
      contractFilename: null,
    })

    const fields = await adapter.listCampaignFields(campaign.id)
    expect(fields.find((f) => f.field_key === 'platforms')?.field_value).toBe(
      'TikTok, Instagram, YouTube',
    )
  })

  it('adds a new rule without touching the one already there', async () => {
    const { adapter, campaign } = await setUp()
    const result = parseResult({ rules: [{ body: 'Every video carries #ad.', source_quote: 'Every video carries #ad.' }] })

    await applyCampaignUpdate(adapter, {
      campaignId: campaign.id,
      result,
      acceptedNewFieldKeys: new Set(),
      acceptedConflictFieldKeys: new Set(),
      briefText: null,
      briefFilename: null,
      contractText: null,
      contractFilename: null,
    })

    const rules = await adapter.listCampaignRules(campaign.id)
    expect(rules.map((r) => r.body).sort()).toEqual([
      'Every video carries #ad.',
      'Never name a competitor.',
    ])
  })

  it('stores the new document even when nothing from it is accepted', async () => {
    const { adapter, campaign } = await setUp()
    const result = parseResult()

    await applyCampaignUpdate(adapter, {
      campaignId: campaign.id,
      result,
      acceptedNewFieldKeys: new Set(),
      acceptedConflictFieldKeys: new Set(),
      briefText: 'A brand new brief, in full.',
      briefFilename: 'brief-v2.md',
      contractText: null,
      contractFilename: null,
    })

    const documents = await adapter.listCampaignDocuments(campaign.id)
    expect(documents.some((d) => d.raw_text === 'A brand new brief, in full.')).toBe(true)
  })

  it('does not fail the whole update when a bonus tier repeats an existing threshold', async () => {
    const { adapter, campaign } = await setUp()
    await adapter.addBonusTier({
      campaign_id: campaign.id,
      label: '50k',
      threshold_views: 50000,
      payout_cents: 5000,
      view_window_days: 30,
    })
    const result = parseResult({
      rules: [{ body: 'Every video carries #ad.', source_quote: 'Every video carries #ad.' }],
      bonus_tiers: [
        { label: '50k', threshold_views: 50000, payout_cents: 5000, view_window_days: 30, source_quote: null },
        { label: '100k', threshold_views: 100000, payout_cents: 10000, view_window_days: 30, source_quote: null },
      ],
    })

    await applyCampaignUpdate(adapter, {
      campaignId: campaign.id,
      result,
      acceptedNewFieldKeys: new Set(),
      acceptedConflictFieldKeys: new Set(),
      briefText: null,
      briefFilename: null,
      contractText: null,
      contractFilename: null,
    })

    const tiers = await adapter.listBonusTiers(campaign.id)
    expect(tiers.map((t) => t.threshold_views).sort((a, b) => a - b)).toEqual([50000, 100000])
    // The rule in the same batch still landed - one duplicate does not sink
    // everything else in the update.
    const rules = await adapter.listCampaignRules(campaign.id)
    expect(rules.some((r) => r.body === 'Every video carries #ad.')).toBe(true)
  })
})
