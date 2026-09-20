// The v5 upgrade, tested against a real v3 database that predates the
// pays_per_platform column (v4 and v5 both run on the way up).
//
// This is the riskiest code in the store: it runs once, irreversibly, on the
// only copy of his data, and a throw inside a Dexie upgrade stops the database
// opening at all. So it is exercised the way it will actually run - open a v3
// database, put representative rows in it, close it, and open the real
// LocalDatabase over the top.

import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import { LocalAdapter } from './LocalAdapter'
import { LocalDatabase } from './db'

const USER = '11111111-1111-4111-8111-111111111111'

let name: string

beforeEach(() => {
  indexedDB = new IDBFactory()
  name = `upgrade-${crypto.randomUUID()}`
})

/** A database at v3 - the schema as it stood before accounts existed. */
function openV3(): Dexie {
  const db = new Dexie(name)
  db.version(1).stores({
    campaigns: 'id, user_id, is_active, name',
    campaign_documents: 'id, campaign_id, kind',
    campaign_fields: 'id, campaign_id, &[campaign_id+field_key], source',
    campaign_angles: 'id, campaign_id, is_verified, sort_order',
    campaign_rules: 'id, campaign_id, sort_order',
    videos: 'id, campaign_id, phase, [campaign_id+phase], owed_for_date, kind',
    video_posts: 'id, video_id, &[video_id+platform]',
    phase_events: '++id, video_id, [video_id+occurred_at], to_phase, occurred_at',
    bonus_tiers: 'id, campaign_id, &[campaign_id+threshold_views]',
    bonus_claims: 'id, video_id, &[video_id+bonus_tier_id]',
    time_estimates: 'id, &[user_id+setup], setup',
    user_settings: 'user_id',
    _outbox: '++id, queued_at, table_name',
  })
  db.version(2).stores({
    phase_events: '++id, &client_id, video_id, [video_id+occurred_at], to_phase, occurred_at',
  })
  db.version(3).stores({
    warmup_events: '++id, &client_id, campaign_id, [campaign_id+occurred_at], occurred_at',
  })
  return db
}

function campaignRow(over: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    user_id: USER,
    name: 'A campaign',
    company: null,
    is_active: true,
    approval_mode: 'none',
    default_setup: 'face',
    daily_post_quota: 1,
    pay_per_video_cents: 3500,
    cycle_size: null,
    opening_post_count: 0,
    brief_is_incomplete: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  }
}

/** Runs the upgrade by opening the real database over the v3 one. */
async function upgrade(): Promise<LocalDatabase> {
  const db = new LocalDatabase(name)
  await db.open()
  return db
}

describe('campaigns saved before pays_per_platform existed', () => {
  it('gets false filled in, and keeps every other value', async () => {
    const v3 = openV3()
    await v3.open()
    const campaign = campaignRow({ pay_per_video_cents: 3500 })
    await v3.table('campaigns').add(campaign)
    v3.close()

    const db = await upgrade()
    const row = await db.campaigns.get(campaign.id)
    expect(row?.pays_per_platform).toBe(false)
    expect(row?.pay_per_video_cents).toBe(3500)
  })

  it('leaves a campaign that already says it pays per platform alone', async () => {
    const v3 = openV3()
    await v3.open()
    const campaign = campaignRow({ pays_per_platform: true })
    await v3.table('campaigns').add(campaign)
    v3.close()

    const db = await upgrade()
    expect((await db.campaigns.get(campaign.id))?.pays_per_platform).toBe(true)
  })

  it('lets him change the rate on one - the edit that used to be refused', async () => {
    const v3 = openV3()
    await v3.open()
    const campaign = campaignRow({ pay_per_video_cents: 3500 })
    await v3.table('campaigns').add(campaign)
    v3.close()

    const adapter = new LocalAdapter(await upgrade(), USER)
    await adapter.updateCampaign(campaign.id, { pay_per_video_cents: 4000 })
    expect((await adapter.getCampaign(campaign.id))?.pay_per_video_cents).toBe(4000)
  })

  it('takes a campaign from a server that has no such column, keeping the local setting', async () => {
    const adapter = new LocalAdapter(await upgrade(), USER)
    const created = await adapter.createCampaign({
      name: 'Pump',
      company: null,
      default_setup: 'face',
      pay_per_video_cents: 1600,
      cycle_size: null,
      pays_per_platform: true,
    })

    const { pays_per_platform: _omitted, ...fromServer } = { ...created, name: 'Pump (renamed)' }
    await adapter.applyRemoteRow('campaigns', fromServer)

    const after = await adapter.getCampaign(created.id)
    expect(after?.name).toBe('Pump (renamed)')
    expect(after?.pays_per_platform).toBe(true)
  })
})
