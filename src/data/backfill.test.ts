// Backfilling a rate onto posted-but-unpriced videos.
//
// This is the one operation that writes into the ledger after the fact, so
// what it must NOT touch matters more than what it does. A video that already
// carries a snapshot keeps it forever: that snapshot is what stops a rate
// change from rewriting what past work earned.

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import { LocalDatabase } from './local/db'
import { LocalAdapter } from './local/LocalAdapter'
import type { Campaign } from './schema'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: LocalAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`backfill-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})

async function makeCampaign(rateCents: number | null): Promise<Campaign> {
  return adapter.createCampaign({
    name: 'Test',
    company: null,
    default_setup: 'face',
    approval_mode: 'none',
    pay_per_video_cents: rateCents,
    cycle_size: null,
  })
}

async function postOne(campaignId: string) {
  const video = await adapter.createVideo({
    campaign_id: campaignId,
    setup: 'face',
    angle_id: null,
    script: null,
    blocked_reason: null,
    owed_for_date: null,
    rate_snapshot_cents: null,
    posted_at: null,
  })
  return adapter.markVideoPosted(video.id, { session: 'post' })
}

describe('backfilling an unpriced post', () => {
  it('prices posts made while the campaign had no rate', async () => {
    const campaign = await makeCampaign(null)
    const a = await postOne(campaign.id)
    const b = await postOne(campaign.id)

    expect(a.rate_snapshot_cents).toBeNull()
    expect(b.rate_snapshot_cents).toBeNull()

    await adapter.updateCampaign(campaign.id, { pay_per_video_cents: 3500 })

    expect((await adapter.getVideo(a.id))?.rate_snapshot_cents).toBe(3500)
    expect((await adapter.getVideo(b.id))?.rate_snapshot_cents).toBe(3500)
  })

  it('never touches a video that already locked in a rate', async () => {
    const campaign = await makeCampaign(3500)
    const priced = await postOne(campaign.id)
    expect(priced.rate_snapshot_cents).toBe(3500)

    // The rate changes. This is not a backfill trigger - the campaign already
    // had a rate - but even asking directly must leave the snapshot alone.
    await adapter.updateCampaign(campaign.id, { pay_per_video_cents: 9900 })
    expect(await adapter.backfillUnpricedVideos(campaign.id)).toBe(0)

    expect((await adapter.getVideo(priced.id))?.rate_snapshot_cents).toBe(3500)
  })

  it('leaves priced videos alone while filling in unpriced ones alongside them', async () => {
    const campaign = await makeCampaign(3500)
    const priced = await postOne(campaign.id)

    // A video posted during a window where the rate was cleared.
    await adapter.updateCampaign(campaign.id, { pay_per_video_cents: null })
    const unpriced = await postOne(campaign.id)
    expect(unpriced.rate_snapshot_cents).toBeNull()

    await adapter.updateCampaign(campaign.id, { pay_per_video_cents: 9900 })

    // Only the blank was filled. The earned rate stands.
    expect((await adapter.getVideo(priced.id))?.rate_snapshot_cents).toBe(3500)
    expect((await adapter.getVideo(unpriced.id))?.rate_snapshot_cents).toBe(9900)
  })

  it('does nothing while the campaign still has no rate', async () => {
    const campaign = await makeCampaign(null)
    const video = await postOne(campaign.id)

    expect(await adapter.backfillUnpricedVideos(campaign.id)).toBe(0)
    // Not 0 cents - still unknown.
    expect((await adapter.getVideo(video.id))?.rate_snapshot_cents).toBeNull()
  })

  it('ignores videos that are not posted', async () => {
    const campaign = await makeCampaign(null)
    const unposted = await adapter.createVideo({
      campaign_id: campaign.id,
      setup: 'face',
      angle_id: null,
      script: null,
      blocked_reason: null,
      owed_for_date: null,
      rate_snapshot_cents: null,
      posted_at: null,
    })

    await adapter.updateCampaign(campaign.id, { pay_per_video_cents: 3500 })

    // A rate is locked in when a video is posted, not before.
    expect((await adapter.getVideo(unposted.id))?.rate_snapshot_cents).toBeNull()
  })

  it('does not reach into another campaign', async () => {
    const mine = await makeCampaign(null)
    const other = await makeCampaign(null)
    const theirs = await postOne(other.id)

    await adapter.updateCampaign(mine.id, { pay_per_video_cents: 3500 })

    expect((await adapter.getVideo(theirs.id))?.rate_snapshot_cents).toBeNull()
  })

  it('writes no phase event, because nothing changed phase', async () => {
    const campaign = await makeCampaign(null)
    const video = await postOne(campaign.id)
    const before = await adapter.listPhaseEvents({ videoId: video.id })

    await adapter.updateCampaign(campaign.id, { pay_per_video_cents: 3500 })

    const after = await adapter.listPhaseEvents({ videoId: video.id })
    expect(after).toEqual(before)
  })

  it('is idempotent', async () => {
    const campaign = await makeCampaign(null)
    const video = await postOne(campaign.id)

    await adapter.updateCampaign(campaign.id, { pay_per_video_cents: 3500 })
    expect(await adapter.backfillUnpricedVideos(campaign.id)).toBe(0)
    expect((await adapter.getVideo(video.id))?.rate_snapshot_cents).toBe(3500)
  })
})
