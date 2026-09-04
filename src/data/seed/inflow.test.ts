// The seed's job is to be honest about where every value came from. These
// tests are the guard on that: they fail if a later edit quietly promotes a
// field to `documented`, invents a document to back it, or merges the two
// angle sources into one list of eight.

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import { LocalDatabase } from '../local/db'
import { LocalAdapter } from '../local/LocalAdapter'
import { INFLOW_ANGLES_UNVERIFIED, INFLOW_ANGLES_VERIFIED, INFLOW_DOCUMENTS } from './inflow'
import { INFLOW_CAMPAIGN_ID, ensureSeeded } from './index'

const USER = '11111111-1111-4111-8111-111111111111'

let adapter: LocalAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`seed-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
  await ensureSeeded(adapter)
})

describe('the Inflow campaign', () => {
  it('loads with the contracted figures as integer cents', async () => {
    const campaign = await adapter.getCampaign(INFLOW_CAMPAIGN_ID)
    expect(campaign).toMatchObject({
      name: 'Inflow',
      company: 'Inflowpay',
      approval_mode: 'video',
      default_setup: 'face',
      daily_post_quota: 1,
      pay_per_video_cents: 3500,
      cycle_size: 60,
      opening_post_count: 13,
    })
  })

  it('is marked as having a damaged brief', async () => {
    const campaign = await adapter.getCampaign(INFLOW_CAMPAIGN_ID)
    expect(campaign?.brief_is_incomplete).toBe(true)
  })

  it('seeds both bonus tiers with the 30-day view window', async () => {
    const tiers = await adapter.listBonusTiers(INFLOW_CAMPAIGN_ID)
    expect(tiers).toHaveLength(2)
    expect(tiers[0]).toMatchObject({ threshold_views: 50_000, payout_cents: 5000, view_window_days: 30 })
    expect(tiers[1]).toMatchObject({ threshold_views: 100_000, payout_cents: 10_000, view_window_days: 30 })
  })

  it('sets no bonus probabilities at all', async () => {
    // Every probability defaults to zero, and none is guessed on his behalf,
    // so there is nothing to create until he judges one.
    expect(await adapter.listBonusClaims()).toEqual([])
  })

  it('is idempotent', async () => {
    const wroteAgain = await ensureSeeded(adapter)
    expect(wroteAgain).toBe(false)

    const campaigns = await adapter.listCampaigns()
    expect(campaigns).toHaveLength(1)
    const angles = await adapter.listCampaignAngles(INFLOW_CAMPAIGN_ID)
    expect(angles).toHaveLength(8)
  })
})

describe('provenance', () => {
  it('marks nothing as documented, because no document is stored to quote', async () => {
    const fields = await adapter.listCampaignFields(INFLOW_CAMPAIGN_ID)
    expect(fields.filter((f) => f.source === 'documented')).toEqual([])
  })

  it('marks nothing as parsed_unreviewed, because no parser has run', async () => {
    const fields = await adapter.listCampaignFields(INFLOW_CAMPAIGN_ID)
    expect(fields.filter((f) => f.source === 'parsed_unreviewed')).toEqual([])
  })

  it('seeds no campaign documents rather than inventing document text', async () => {
    expect(INFLOW_DOCUMENTS).toEqual([])
    expect(await adapter.listCampaignDocuments(INFLOW_CAMPAIGN_ID)).toEqual([])
  })

  it('gives every confirmed field a null confirmed_at, since none was reviewed', async () => {
    const fields = await adapter.listCampaignFields(INFLOW_CAMPAIGN_ID)
    expect(fields.every((f) => f.confirmed_at === null)).toBe(true)
  })

  it('leaves the SPEC section 12 blanks missing and empty', async () => {
    const fields = await adapter.listCampaignFields(INFLOW_CAMPAIGN_ID)
    const byKey = new Map(fields.map((f) => [f.field_key, f]))

    for (const key of [
      'submission_url', // 12.2
      'trial_first_post_date', // 12.4
      'wider_topic_counts_as_deliverable', // 12.5
    ]) {
      const field = byKey.get(key)
      expect(field, `${key} should be seeded`).toBeDefined()
      expect(field?.source, `${key} should be missing`).toBe('missing')
      expect(field?.field_value, `${key} should hold no value`).toBeNull()
    }
  })

  it('never puts the dispute contact in the submission URL', async () => {
    const fields = await adapter.listCampaignFields(INFLOW_CAMPAIGN_ID)
    const serialised = JSON.stringify(fields)
    // support@sideshift.app is a dispute contact, not a submission link. A
    // plausible wrong answer here is worse than the blank.
    expect(serialised).not.toContain('sideshift.app')
  })

  it('leaves the filmed-but-unedited opening count blank', async () => {
    const settings = await adapter.getUserSettings()
    expect(settings.opening_unedited_count).toBeNull()
  })
})

describe('angles', () => {
  it('loads the six from the brief as verified', async () => {
    const angles = await adapter.listCampaignAngles(INFLOW_CAMPAIGN_ID)
    const verified = angles.filter((a) => a.is_verified)

    expect(verified).toHaveLength(6)
    expect(verified.map((a) => a.label)).toEqual([
      'A. Frozen funds',
      'B. Waiting for your own money',
      'C. Your country is not supported',
      'D. Taxes handled',
      'E. The real rate',
      'F. You use it too',
    ])
  })

  it('splits the six into the brief FEAR and GREED families', async () => {
    const angles = await adapter.listCampaignAngles(INFLOW_CAMPAIGN_ID)
    const verified = angles.filter((a) => a.is_verified)

    expect(verified.filter((a) => a.family === 'fear')).toHaveLength(4)
    expect(verified.filter((a) => a.family === 'greed')).toHaveLength(2)
  })

  it('loads the two skill-file angles unverified and unfamilied', async () => {
    const angles = await adapter.listCampaignAngles(INFLOW_CAMPAIGN_ID)
    const unverified = angles.filter((a) => !a.is_verified)

    expect(unverified.map((a) => a.label)).toEqual([
      'Nobody picks up',
      'Switching is not a project',
    ])
    // The brief's FEAR/GREED split is a brief construct. Nothing assigns these
    // two to either side, so neither is guessed.
    expect(unverified.every((a) => a.family === null)).toBe(true)
  })

  it('keeps the two sources separable rather than merged', async () => {
    // Eight rows exist, but no query returns them as one authored list: the
    // brief documents six, and the disagreement between the sources is itself
    // information that a merged list would destroy.
    const angles = await adapter.listCampaignAngles(INFLOW_CAMPAIGN_ID)
    expect(angles).toHaveLength(8)

    expect(INFLOW_ANGLES_VERIFIED).toHaveLength(6)
    expect(INFLOW_ANGLES_UNVERIFIED).toHaveLength(2)
    // The two sets share no labels, so nothing was duplicated across them.
    const verifiedLabels = new Set(INFLOW_ANGLES_VERIFIED.map((a) => a.label))
    expect(INFLOW_ANGLES_UNVERIFIED.some((a) => verifiedLabels.has(a.label))).toBe(false)
  })
})

describe('the never-do list', () => {
  it('loads every surviving rule', async () => {
    const rules = await adapter.listCampaignRules(INFLOW_CAMPAIGN_ID)
    expect(rules).toHaveLength(10)
    expect(rules[0].body).toContain('taxes')
  })

  it('keeps the tax rule and the escape wording together', async () => {
    const rules = await adapter.listCampaignRules(INFLOW_CAMPAIGN_ID)
    const taxRule = rules.find((r) => r.body.includes('Escape'))
    // "Escape" applies to fees, freezes and waiting, never to taxes - the two
    // halves of that rule must not be separated.
    expect(taxRule?.body).toContain('never to taxes')
  })
})
