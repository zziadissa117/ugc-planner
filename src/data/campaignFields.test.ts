// Editing a field by hand, and what that does to its provenance.
//
// The rule these protect: a value he typed is his word for it and can never
// become `documented`, and a field with an operational meaning must move its
// campaign column with it - or a screen shows a confirmed rate next to "not
// saved yet" and neither figure can be trusted.

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import type { Campaign, DataAdapter } from './index'
import { LocalDatabase } from './local/db'
import { LocalAdapter } from './local/LocalAdapter'
import {
  centsToDollarsInput,
  confirmFieldValue,
  parseCount,
  parseDollarsToCents,
  saveFieldValue,
} from './campaignFields'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: DataAdapter
let campaign: Campaign

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`fields-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()

  campaign = await adapter.createCampaign({
    name: 'Vertus',
    company: 'Vertus.AI',
    default_setup: 'face',
    approval_mode: 'none',
    pay_per_video_cents: null,
    cycle_size: null,
  })
})

describe('parsing money without floats', () => {
  it('reads dollars as integer cents', () => {
    expect(parseDollarsToCents('35')).toBe(3500)
    expect(parseDollarsToCents('35.00')).toBe(3500)
    expect(parseDollarsToCents('$20.50')).toBe(2050)
    expect(parseDollarsToCents('1,200')).toBe(120000)
  })

  it('is exact where a float would not be', () => {
    // 35.10 * 100 is 3510.0000000000005 in floating point.
    expect(parseDollarsToCents('35.10')).toBe(3510)
    expect(parseDollarsToCents('0.07')).toBe(7)
  })

  it('refuses anything that is not a plain amount', () => {
    for (const bad of ['', 'free', '35.123', '-5', '3 5', '£20']) {
      expect(parseDollarsToCents(bad)).toBeNull()
    }
  })

  it('round-trips back to a dollars string', () => {
    expect(centsToDollarsInput(3500)).toBe('35.00')
    expect(centsToDollarsInput(7)).toBe('0.07')
  })

  it('reads counts as whole numbers only', () => {
    expect(parseCount('120')).toBe(120)
    expect(parseCount('0')).toBe(0)
    expect(parseCount('12.5')).toBeNull()
    expect(parseCount('')).toBeNull()
  })
})

describe('saving a field by hand', () => {
  it('marks it user_entered, never documented, and carries no quote', async () => {
    await saveFieldValue(adapter, campaign.id, 'platforms', 'TikTok, Instagram')

    const [field] = await adapter.listCampaignFields(campaign.id)
    expect(field.field_value).toBe('TikTok, Instagram')
    expect(field.source).toBe('user_entered')
    // Typed by hand: there is no document behind it to cite.
    expect(field.source_quote).toBeNull()
  })

  it('overwrites a parsed value, and stops it claiming to be documented', async () => {
    await adapter.setCampaignField({
      campaign_id: campaign.id,
      field_key: 'platforms',
      field_value: 'YouTube',
      source: 'parsed_unreviewed',
      source_quote: 'Required platforms: YouTube',
      source_document_id: null,
    })

    await saveFieldValue(adapter, campaign.id, 'platforms', 'TikTok')

    const [field] = await adapter.listCampaignFields(campaign.id)
    expect(field.field_value).toBe('TikTok')
    expect(field.source).toBe('user_entered')
    // The old quote described the old value. Keeping it would leave his own
    // number wearing a document's authority.
    expect(field.source_quote).toBeNull()
  })

  it('moves the campaign column with the field', async () => {
    await saveFieldValue(adapter, campaign.id, 'pay_per_video_cents', '2000')

    const updated = await adapter.getCampaign(campaign.id)
    expect(updated?.pay_per_video_cents).toBe(2000)
  })

  it('clears back to "not saved yet" rather than storing a blank', async () => {
    await saveFieldValue(adapter, campaign.id, 'pay_per_video_cents', '2000')
    await saveFieldValue(adapter, campaign.id, 'pay_per_video_cents', '   ')

    const [field] = await adapter.listCampaignFields(campaign.id)
    expect(field.field_value).toBeNull()
    expect(field.source).toBe('missing')

    const updated = await adapter.getCampaign(campaign.id)
    // Null, not 0: a rate nobody set is not a rate of nothing.
    expect(updated?.pay_per_video_cents).toBeNull()
  })
})

describe('confirming a parsed field', () => {
  it('promotes it and fills the column in one step', async () => {
    await adapter.setCampaignField({
      campaign_id: campaign.id,
      field_key: 'pay_per_video_cents',
      field_value: '2000',
      source: 'parsed_unreviewed',
      source_quote: '$20.00 per approved deliverable',
      source_document_id: null,
    })

    // Unconfirmed, the column stays empty - amber is not a rate yet.
    expect((await adapter.getCampaign(campaign.id))?.pay_per_video_cents).toBeNull()

    const confirmed = await confirmFieldValue(adapter, campaign.id, 'pay_per_video_cents')

    expect(confirmed.source).toBe('documented')
    expect((await adapter.getCampaign(campaign.id))?.pay_per_video_cents).toBe(2000)
  })
})
