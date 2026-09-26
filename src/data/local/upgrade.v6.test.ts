// The v6 upgrade: accounts saved before campaign_accounts.bonus_only existed
// get `false` filled in, so the validator stops refusing every edit to them.
// Run the way it will really run - a v5 database with an old account row in
// it, opened by the real LocalDatabase.

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
  name = `upgrade-v6-${crypto.randomUUID()}`
})

/** The store's shape at v5, with no upgrade functions: nothing is in it yet. */
function openV5(): Dexie {
  const db = new Dexie(name)
  db.version(5).stores({
        campaigns: 'id, user_id, is_active, name',
        campaign_accounts: 'id, user_id, campaign_id, &[campaign_id+platform], [user_id+status], status',
        campaign_documents: 'id, campaign_id, kind',
        campaign_fields: 'id, campaign_id, &[campaign_id+field_key], source',
        campaign_angles: 'id, campaign_id, is_verified, sort_order',
        campaign_hooks: 'id, campaign_id, angle_id, [campaign_id+used_at], used_at',
        campaign_rules: 'id, campaign_id, sort_order',
        videos: 'id, campaign_id, phase, [campaign_id+phase], owed_for_date, kind',
        video_posts: 'id, video_id, &[video_id+platform], &[video_id+account_id], account_id',
        phase_events: '++id, &client_id, video_id, [video_id+occurred_at], to_phase, occurred_at, work_session_id',
        work_sessions: 'id, user_id, campaign_id, [campaign_id+started_at], [user_id+started_at], started_at',
        warmup_events: '++id, &client_id, campaign_id, account_id, [campaign_id+occurred_at], [account_id+occurred_at], occurred_at',
        bonus_tiers: 'id, campaign_id, &[campaign_id+threshold_views]',
        bonus_claims: 'id, video_id, &[video_id+bonus_tier_id]',
        time_estimates: 'id, &[user_id+setup], setup',
        user_settings: 'user_id',
        _outbox: '++id, queued_at, table_name',
})
  return db
}

const stamp = new Date().toISOString()

async function seedOldAccount(): Promise<{ campaignId: string; accountId: string }> {
  const v5 = openV5()
  await v5.open()
  const campaignId = crypto.randomUUID()
  const accountId = crypto.randomUUID()
  await v5.table('campaigns').add({
    id: campaignId, user_id: USER, name: 'Polsia', company: null, is_active: true, approval_mode: 'none',
    default_setup: 'face', daily_post_quota: 1, pay_per_video_cents: 3500, monthly_pay_override_cents: null,
    pays_per_platform: false, cycle_size: null, opening_post_count: 0, brief_is_incomplete: false,
    created_at: stamp, updated_at: stamp,
  })
  await v5.table('campaign_accounts').add({
    id: accountId, user_id: USER, campaign_id: campaignId, platform: 'Facebook', handle: '@me', email: null,
    password: null, posts_per_day: 0, status: 'ready', is_active: true, sort_order: 0, created_at: stamp, updated_at: stamp,
  })
  v5.close()
  return { campaignId, accountId }
}

describe('accounts saved before bonus_only existed', () => {
  it('get false filled in, and keep every other value', async () => {
    const { accountId } = await seedOldAccount()
    const db = new LocalDatabase(name)
    await db.open()
    const row = await db.campaign_accounts.get(accountId)
    expect(row?.bonus_only).toBe(false)
    expect(row?.handle).toBe('@me')
  })

  it('can then be switched to bonus only', async () => {
    const { accountId } = await seedOldAccount()
    const db = new LocalDatabase(name)
    await db.open()
    const adapter = new LocalAdapter(db, USER)
    const updated = await adapter.updateCampaignAccount(accountId, { bonus_only: true })
    expect(updated.bonus_only).toBe(true)
  })

  it('keep the local setting when the server sends a row without the column', async () => {
    const { accountId } = await seedOldAccount()
    const db = new LocalDatabase(name)
    await db.open()
    const adapter = new LocalAdapter(db, USER)
    const updated = await adapter.updateCampaignAccount(accountId, { bonus_only: true })
    const { bonus_only: _omitted, ...fromServer } = { ...updated, handle: '@renamed' }
    await adapter.applyRemoteRow('campaign_accounts', fromServer)
    const after = await db.campaign_accounts.get(accountId)
    expect(after?.handle).toBe('@renamed')
    expect(after?.bonus_only).toBe(true)
  })
})

describe('campaigns saved before needs_submission existed', () => {
  it('get false filled in by the v7 upgrade, and can be switched on', async () => {
    const { campaignId } = await seedOldAccount()
    const db = new LocalDatabase(name)
    await db.open()
    expect((await db.campaigns.get(campaignId))?.needs_submission).toBe(false)
    const adapter = new LocalAdapter(db, USER)
    await adapter.updateCampaign(campaignId, { needs_submission: true })
    expect((await adapter.getCampaign(campaignId))?.needs_submission).toBe(true)
  })

  it('keep the local setting when the server sends a row without the column', async () => {
    const { campaignId } = await seedOldAccount()
    const db = new LocalDatabase(name)
    await db.open()
    const adapter = new LocalAdapter(db, USER)
    const updated = await adapter.updateCampaign(campaignId, { needs_submission: true })
    const { needs_submission: _omitted, ...fromServer } = { ...updated, name: 'Polsia (renamed)' }
    await adapter.applyRemoteRow('campaigns', fromServer)
    const after = await adapter.getCampaign(campaignId)
    expect(after?.name).toBe('Polsia (renamed)')
    expect(after?.needs_submission).toBe(true)
  })
})
