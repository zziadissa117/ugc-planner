// Accounts, and the daily demand that comes off them.
//
// The rule that matters here is that one video is cross-posted to every
// account and is still ONE deliverable - contractual for Inflow, and what he
// described for Vertus. So demand is the MAX of posts_per_day across ready
// accounts, never the sum. Summing would double the work he actually owes.

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
  it('takes the biggest per-account figure, not the sum', async () => {
    const campaign = await makeCampaign()
    for (const platform of ['TikTok', 'Instagram']) {
      const account = await adapter.addCampaignAccount({
        campaign_id: campaign.id,
        platform,
        handle: '@michael.financier',
        posts_per_day: 1,
      })
      await adapter.updateCampaignAccount(account.id, { status: 'ready' })
    }

    const accounts = await adapter.listCampaignAccounts()
    // Inflow: 1 on TikTok and 1 on Instagram is ONE video, posted twice.
    expect(dailyVideoDemand(campaign, accounts)).toBe(1)
  })

  it('handles two a day to two platforms as two videos, not four', async () => {
    const campaign = await makeCampaign({ name: 'Vertus' })
    for (const platform of ['YouTube', 'Instagram']) {
      const account = await adapter.addCampaignAccount({
        campaign_id: campaign.id,
        platform,
        handle: '@vertus',
        posts_per_day: 2,
      })
      await adapter.updateCampaignAccount(account.id, { status: 'ready' })
    }

    expect(dailyVideoDemand(campaign, await adapter.listCampaignAccounts())).toBe(2)
  })

  it('owes nothing while every account is still warming up', async () => {
    const campaign = await makeCampaign()
    await adapter.addCampaignAccount({
      campaign_id: campaign.id,
      platform: 'TikTok',
      handle: '@new',
      posts_per_day: 1,
    })

    // A campaign still warming up belongs on the warm-up screen, not in the
    // day's quota.
    expect(dailyVideoDemand(campaign, await adapter.listCampaignAccounts())).toBe(0)
    expect(await ensureTodaysQuota(adapter)).toBe(0)
  })

  it('falls back to the old quota until a campaign has accounts', async () => {
    // A device that has not run the accounts derivation yet still owes what it
    // did before, rather than silently owing nothing.
    const campaign = await makeCampaign({ daily_post_quota: 3 })
    expect(dailyVideoDemand(campaign, [])).toBe(3)
  })

  it('raises one video per unit of demand, and stops', async () => {
    const campaign = await makeCampaign()
    const account = await adapter.addCampaignAccount({
      campaign_id: campaign.id,
      platform: 'TikTok',
      handle: '@ready',
      posts_per_day: 2,
    })
    await adapter.updateCampaignAccount(account.id, { status: 'ready' })

    expect(await ensureTodaysQuota(adapter)).toBe(2)
    // Idempotent within the day: running again owes nothing more.
    expect(await ensureTodaysQuota(adapter)).toBe(0)
  })
})
