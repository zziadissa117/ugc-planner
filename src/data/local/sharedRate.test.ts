// One deliverable earns the campaign's rate once, however the platforms it
// goes to share it - and however the roster of ready accounts moves between
// one tick and the next.

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import { netCents } from '../earnings'
import { LocalDatabase } from './db'
import { LocalAdapter } from './LocalAdapter'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: LocalAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`shared-rate-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})

describe('a shared rate when an account becomes ready between ticks', () => {
  it('never pays more than the rate for one video', async () => {
    const campaign = await adapter.createCampaign({
      name: 'Inflow', company: null, default_setup: 'face', approval_mode: 'none',
      daily_post_quota: 1, pay_per_video_cents: 3500, cycle_size: null,
    })
    const tiktok = await adapter.addCampaignAccount({ campaign_id: campaign.id, platform: 'TikTok', handle: null, status: 'ready' })
    const instagram = await adapter.addCampaignAccount({ campaign_id: campaign.id, platform: 'Instagram', handle: null, status: 'new' })
    const video = await adapter.createVideo({
      campaign_id: campaign.id, setup: 'face', angle_id: null, script: null, blocked_reason: null,
      owed_for_date: null, rate_snapshot_cents: null, posted_at: null,
    })

    // TikTok is the only account he can post from: its tick is the whole $35.
    await adapter.addVideoPost({ video_id: video.id, account_id: tiktok.id, platform: 'TikTok', url: null, view_count: null, view_count_entered_at: null })
    expect(netCents(await adapter.listEarningsEvents())).toBe(3500)

    // Instagram finishes warming up and the same video is ticked there too.
    // Before the cap this paid another $17.50 - $52.50 for a $35 video.
    await adapter.updateCampaignAccount(instagram.id, { status: 'ready' })
    await adapter.addVideoPost({ video_id: video.id, account_id: instagram.id, platform: 'Instagram', url: null, view_count: null, view_count_entered_at: null })
    expect(netCents(await adapter.listEarningsEvents())).toBe(3500)
  })

  it('still splits the rate when both were ready from the start', async () => {
    const campaign = await adapter.createCampaign({
      name: 'Inflow', company: null, default_setup: 'face', approval_mode: 'none',
      daily_post_quota: 1, pay_per_video_cents: 3500, cycle_size: null,
    })
    const tiktok = await adapter.addCampaignAccount({ campaign_id: campaign.id, platform: 'TikTok', handle: null, status: 'ready' })
    const instagram = await adapter.addCampaignAccount({ campaign_id: campaign.id, platform: 'Instagram', handle: null, status: 'ready' })
    const video = await adapter.createVideo({
      campaign_id: campaign.id, setup: 'face', angle_id: null, script: null, blocked_reason: null,
      owed_for_date: null, rate_snapshot_cents: null, posted_at: null,
    })
    await adapter.addVideoPost({ video_id: video.id, account_id: tiktok.id, platform: 'TikTok', url: null, view_count: null, view_count_entered_at: null })
    expect(netCents(await adapter.listEarningsEvents())).toBe(1750)
    await adapter.addVideoPost({ video_id: video.id, account_id: instagram.id, platform: 'Instagram', url: null, view_count: null, view_count_entered_at: null })
    expect(netCents(await adapter.listEarningsEvents())).toBe(3500)
  })
})
