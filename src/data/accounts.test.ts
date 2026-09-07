// Accounts, and the daily demand that is deliberately NOT derived from them.
//
// One video cross-posted to every account is still ONE deliverable, so the
// number of platforms must never change what a day owes. Demand used to be
// read as the maximum posts_per_day across ready accounts, which got the
// arithmetic right by accident and the model wrong: the account list decided
// the obligation. It is the campaign's own daily_post_quota, full stop.

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import { DataError } from './local/LocalAdapter'
import { LocalAdapter } from './local/LocalAdapter'
import { LocalDatabase } from './local/db'
import type { Campaign } from './schema'
import { dailyVideoDemand, ensureTodaysQuota } from './today'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: LocalAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`accounts-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})

async function makeCampaign(overrides: Partial<Campaign> = {}) {
  return adapter.createCampaign({
    name: 'Test campaign',
    company: null,
    default_setup: 'face',
    approval_mode: 'none',
    daily_post_quota: 0,
    pay_per_video_cents: 3500,
    cycle_size: null,
    ...overrides,
  })
}

describe('accounts', () => {
  it('refuses two accounts on the same platform for one campaign', async () => {
    const campaign = await makeCampaign()
    await adapter.addCampaignAccount({
      campaign_id: campaign.id,
      platform: 'TikTok',
      handle: '@one',
      posts_per_day: 1,
    })

    await expect(
      adapter.addCampaignAccount({
        campaign_id: campaign.id,
        platform: 'TikTok',
        handle: '@two',
        posts_per_day: 1,
      }),
    ).rejects.toBeInstanceOf(DataError)
  })

  it('starts an account as new, never as ready', async () => {
    const campaign = await makeCampaign()
    const account = await adapter.addCampaignAccount({
      campaign_id: campaign.id,
      platform: 'TikTok',
      handle: '@someone',
      posts_per_day: 1,
    })
    // An account nobody has warmed up is not one to post brand content from.
    expect(account.status).toBe('new')
  })

  it('keeps a removed account readable, so a posted video can still say where it went', async () => {
    const campaign = await makeCampaign()
    const account = await adapter.addCampaignAccount({
      campaign_id: campaign.id,
      platform: 'TikTok',
      handle: '@someone',
      posts_per_day: 1,
    })

    await adapter.deleteCampaignAccount(account.id)

    expect(await adapter.listCampaignAccounts(campaign.id)).toHaveLength(0)
    // Soft, not hard: video_posts point at it.
    expect(await adapter.listCampaignAccounts()).toHaveLength(0)
  })
})

describe('what a campaign owes per day', () => {
  it('owes its quota, whatever the platform count', async () => {
    // Inflow: one post a day, on Instagram, TikTok and YouTube. That is ONE
    // deliverable with three destinations - the exact case that used to come
    // out as three.
    const campaign = await makeCampaign({ daily_post_quota: 1 })
    for (const platform of ['TikTok', 'Instagram', 'YouTube']) {
      const account = await adapter.addCampaignAccount({
        campaign_id: campaign.id,
        platform,
        handle: '@michael.financier',
      })
      await adapter.updateCampaignAccount(account.id, { status: 'ready' })
    }

    expect(dailyVideoDemand(campaign)).toBe(1)
    expect(await ensureTodaysQuota(adapter)).toBe(1)
  })

  it('owes four when the campaign says four, on one platform or three', async () => {
    const campaign = await makeCampaign({ name: 'Vertus', daily_post_quota: 4 })
    await adapter.addCampaignAccount({ campaign_id: campaign.id, platform: 'Instagram', handle: '@v' })

    expect(dailyVideoDemand(campaign)).toBe(4)
    expect(await ensureTodaysQuota(adapter)).toBe(4)
  })

  it('still owes its quota while its accounts are new or warming up', async () => {
    // Warm-up is his own tracking, not a gate on the day's work: an account
    // he has not marked ready does not make the campaign owe nothing.
    const campaign = await makeCampaign({ daily_post_quota: 2 })
    await adapter.addCampaignAccount({
      campaign_id: campaign.id,
      platform: 'TikTok',
      handle: '@new',
    })

    expect(dailyVideoDemand(campaign)).toBe(2)
    expect(await ensureTodaysQuota(adapter)).toBe(2)
  })

  it('owes nothing when the quota is zero', async () => {
    await makeCampaign({ daily_post_quota: 0 })
    expect(await ensureTodaysQuota(adapter)).toBe(0)
  })

  it('raises one video per unit of demand, and stops', async () => {
    await makeCampaign({ daily_post_quota: 2 })

    expect(await ensureTodaysQuota(adapter)).toBe(2)
    // Idempotent within the day: running again owes nothing more.
    expect(await ensureTodaysQuota(adapter)).toBe(0)
  })
})
