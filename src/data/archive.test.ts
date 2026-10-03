import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import type { DataAdapter } from '.'
import { LocalDatabase } from './local/db'
import { LocalAdapter } from './local/LocalAdapter'

let adapter: DataAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`archive-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, '11111111-1111-4111-8111-111111111111')
  await db.open()
})

async function campaignWithAccounts() {
  const campaign = await adapter.createCampaign({
    name: 'Inflow', company: null, default_setup: 'face', approval_mode: 'none',
    daily_post_quota: 1, pay_per_video_cents: 1600, cycle_size: null,
  })
  const keep = await adapter.addCampaignAccount({ campaign_id: campaign.id, platform: 'TikTok', handle: '@a', status: 'ready' })
  const gone = await adapter.addCampaignAccount({ campaign_id: campaign.id, platform: 'Instagram', handle: '@b', status: 'ready' })
  return { campaign, keep, gone }
}

describe('archiving a campaign', () => {
  it('takes it off the lists but keeps it findable', async () => {
    const { campaign } = await campaignWithAccounts()
    await adapter.archiveCampaign(campaign.id)
    expect(await adapter.listCampaigns()).toHaveLength(0)
    expect(await adapter.listCampaignAccounts()).toHaveLength(0)
    const archived = await adapter.listArchivedCampaigns()
    expect(archived.map((c) => c.id)).toEqual([campaign.id])
    expect(archived[0].archived_at).not.toBeNull()
  })

  it('restores it with the accounts the archive switched off, not ones removed earlier', async () => {
    const { campaign, keep, gone } = await campaignWithAccounts()
    await adapter.deleteCampaignAccount(gone.id)
    await new Promise((r) => setTimeout(r, 5))
    await adapter.archiveCampaign(campaign.id)
    await adapter.restoreCampaign(campaign.id)
    expect((await adapter.listCampaigns()).map((c) => c.id)).toEqual([campaign.id])
    expect((await adapter.listCampaignAccounts()).map((a) => a.id)).toEqual([keep.id])
    expect(await adapter.listArchivedCampaigns()).toHaveLength(0)
    expect((await adapter.getCampaign(campaign.id))!.archived_at).toBeNull()
  })

  it('a campaign deleted the old way is not in Archived', async () => {
    const { campaign } = await campaignWithAccounts()
    await adapter.deleteCampaign(campaign.id)
    expect(await adapter.listArchivedCampaigns()).toHaveLength(0)
  })
})
