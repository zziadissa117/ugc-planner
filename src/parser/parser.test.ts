import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import type { DataAdapter } from '../data'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { applyParseResult } from './apply'
import { EdgeFunctionParser } from './edgeFunction'
import { PastedJsonParser } from './pastedJson'
import { ParseError, ParserUnavailableError, type ParseResult } from './types'
import { verifyQuotes } from './verify'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: DataAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`parser-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})

const CONTRACT = `Per-post compensation: $35.00 per approved deliverable.
A payment cycle completes when 60 deliverables are approved.
Required platforms: TikTok, Instagram.`

const parse = (json: string) =>
  new PastedJsonParser().parse({ briefText: null, contractText: CONTRACT, json })

describe('the server parser', () => {
  it('is not available, and says why rather than failing silently', async () => {
    const parser = new EdgeFunctionParser()
    expect(parser.isAvailable()).toBe(false)

    // A rejection, not a synchronous throw, so a caller handling it with
    // .catch() cannot lose it.
    await expect(parser.parse({ briefText: null, contractText: null })).rejects.toBeInstanceOf(
      ParserUnavailableError,
    )
    await expect(parser.parse({ briefText: null, contractText: null })).rejects.toThrow(
      /Paste the JSON instead/,
    )
  })
})

describe('the pasted JSON parser', () => {
  it('reads a campaign with its fields', async () => {
    const result = await parse(
      JSON.stringify({
        campaign: { name: 'Inflow', company: 'Inflowpay', approval_mode: 'video' },
        fields: {
          pay_per_video_cents: {
            value: '3500',
            source_quote: '$35.00 per approved deliverable',
            from: 'contract',
          },
        },
      }),
    )

    expect(result.campaign).toEqual({
      name: 'Inflow',
      company: 'Inflowpay',
      approval_mode: 'video',
    })
    expect(result.fields.pay_per_video_cents.value).toBe('3500')
  })

  it('reads bonus tiers and rules', async () => {
    const result = await parse(
      JSON.stringify({
        campaign: { name: 'Inflow' },
        bonus_tiers: [
          { label: '50k', threshold_views: 50_000, payout_cents: 5000, view_window_days: 30 },
        ],
        rules: ['Never name a competitor.'],
      }),
    )

    expect(result.bonus_tiers).toHaveLength(1)
    expect(result.bonus_tiers[0]).toMatchObject({ threshold_views: 50_000, payout_cents: 5000 })
    expect(result.rules).toEqual(['Never name a competitor.'])
  })

  it('refuses a paste with no campaign name', async () => {
    await expect(parse(JSON.stringify({ campaign: {} }))).rejects.toBeInstanceOf(ParseError)
  })

  it('refuses text that is not JSON, without crashing', async () => {
    await expect(parse('not json at all')).rejects.toBeInstanceOf(ParseError)
  })

  it('refuses an approval mode that is not one of the four', async () => {
    await expect(
      parse(JSON.stringify({ campaign: { name: 'X', approval_mode: 'whenever' } })),
    ).rejects.toBeInstanceOf(ParseError)
  })

  it('refuses a bonus tier missing its numbers rather than inventing them', async () => {
    await expect(
      parse(JSON.stringify({ campaign: { name: 'X' }, bonus_tiers: [{ label: '50k' }] })),
    ).rejects.toBeInstanceOf(ParseError)
  })

  it('accepts a bare string field and lets verification reject it for having no quote', async () => {
    const parsed = await parse(
      JSON.stringify({ campaign: { name: 'X' }, fields: { platforms: 'TikTok' } }),
    )
    const { rejected } = verifyQuotes(parsed, { briefText: null, contractText: CONTRACT })
    expect(rejected).toEqual(['platforms'])
  })
})

describe('saving a reviewed parse', () => {
  const baseResult = (): ParseResult => ({
    campaign: { name: 'Inflow', company: 'Inflowpay', approval_mode: 'video' },
    fields: {
      pay_per_video_cents: {
        value: '3500',
        source_quote: '$35.00 per approved deliverable',
        from: 'contract',
      },
      cycle_size: {
        value: '60',
        source_quote: 'A payment cycle completes when 60 deliverables',
        from: 'contract',
      },
      submission_url: { value: null, source_quote: null },
    },
    bonus_tiers: [
      { label: '50k', threshold_views: 50_000, payout_cents: 5000, view_window_days: 30 },
    ],
    rules: ['Never name a competitor.'],
    brief_is_incomplete: false,
    warnings: [],
  })

  const apply = (confirmed: string[], result = baseResult()) =>
    applyParseResult(adapter, {
      result,
      confirmed: new Set(confirmed),
      briefText: 'A brief.',
      briefFilename: 'brief.md',
      contractText: CONTRACT,
      contractFilename: 'contract.md',
    })

  it('stores the raw text of both documents', async () => {
    const campaign = await apply([])
    const documents = await adapter.listCampaignDocuments(campaign.id)

    expect(documents).toHaveLength(2)
    expect(documents.find((d) => d.kind === 'contract')?.raw_text).toBe(CONTRACT)
    expect(documents.find((d) => d.kind === 'brief')?.filename).toBe('brief.md')
  })

  it('leaves unconfirmed fields amber and off the campaign row', async () => {
    const campaign = await apply([])
    const fields = await adapter.listCampaignFields(campaign.id)

    const rate = fields.find((f) => f.field_key === 'pay_per_video_cents')
    expect(rate?.source).toBe('parsed_unreviewed')
    expect(rate?.confirmed_at).toBeNull()
    // Nothing counts as a documented rate until he taps it.
    expect(campaign.pay_per_video_cents).toBeNull()
    expect(campaign.cycle_size).toBeNull()
  })

  it('promotes a confirmed field to documented and writes it onto the campaign', async () => {
    const campaign = await apply(['pay_per_video_cents', 'cycle_size'])
    const fields = await adapter.listCampaignFields(campaign.id)

    const rate = fields.find((f) => f.field_key === 'pay_per_video_cents')
    expect(rate?.source).toBe('documented')
    expect(rate?.confirmed_at).not.toBeNull()
    expect(rate?.source_quote).toBe('$35.00 per approved deliverable')

    expect(campaign.pay_per_video_cents).toBe(3500)
    expect(campaign.cycle_size).toBe(60)
  })

  it('ties a confirmed field to the document it was quoted from', async () => {
    const campaign = await apply(['pay_per_video_cents'])
    const [fields, documents] = await Promise.all([
      adapter.listCampaignFields(campaign.id),
      adapter.listCampaignDocuments(campaign.id),
    ])

    const contract = documents.find((d) => d.kind === 'contract')
    const rate = fields.find((f) => f.field_key === 'pay_per_video_cents')
    expect(rate?.source_document_id).toBe(contract?.id)
  })

  it('writes a field the parser could not find as missing and empty', async () => {
    const campaign = await apply([])
    const fields = await adapter.listCampaignFields(campaign.id)

    const url = fields.find((f) => f.field_key === 'submission_url')
    expect(url?.source).toBe('missing')
    expect(url?.field_value).toBeNull()
  })

  it('never writes a daily quota, which no document states', async () => {
    const campaign = await apply(['pay_per_video_cents'])
    expect(campaign.daily_post_quota).toBe(0)
    expect(campaign.default_setup).toBeNull()
  })

  it('saves a campaign whose brief had nothing in it', async () => {
    // A contract with no brief still saves, with the brief-derived fields
    // blank. This is an acceptance check.
    const campaign = await applyParseResult(adapter, {
      result: baseResult(),
      confirmed: new Set(['pay_per_video_cents']),
      briefText: null,
      briefFilename: null,
      contractText: CONTRACT,
      contractFilename: 'contract.md',
    })

    expect(campaign.pay_per_video_cents).toBe(3500)
    const documents = await adapter.listCampaignDocuments(campaign.id)
    expect(documents.map((d) => d.kind)).toEqual(['contract'])
  })

  it('carries the damaged-brief flag onto the campaign', async () => {
    const campaign = await apply([], { ...baseResult(), brief_is_incomplete: true })
    expect(campaign.brief_is_incomplete).toBe(true)
  })

  it('saves the bonus tiers and rules', async () => {
    const campaign = await apply([])
    expect(await adapter.listBonusTiers(campaign.id)).toHaveLength(1)
    expect(await adapter.listCampaignRules(campaign.id)).toHaveLength(1)
  })

  it('will not write a rate that is not integer cents', async () => {
    const result = baseResult()
    result.fields.pay_per_video_cents.value = '35.5'
    const campaign = await apply(['pay_per_video_cents'], result)

    // The field is still recorded and confirmed; the column is not written
    // from something that is not money.
    expect(campaign.pay_per_video_cents).toBeNull()
  })
})
