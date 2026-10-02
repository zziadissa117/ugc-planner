// The v8 upgrade: campaigns saved before posts_per_week / payout_* existed get
// them filled in - the weekly quota as seven times the daily one he had set,
// exactly as the SQL migration does - so the validator stops refusing every
// edit to them and no figure on screen moves.

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
  name = `upgrade-v8-${crypto.randomUUID()}`
})

function openV7(): Dexie {
  const db = new Dexie(name)
  db.version(7).stores({
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

async function seedOld(daily: number) {
  const v7 = openV7()
  await v7.open()
  const campaignId = crypto.randomUUID()
  const accountId = crypto.randomUUID()
  await v7.table('campaigns').add({
    id: campaignId, user_id: USER, name: 'Inflow', company: null, is_active: true, approval_mode: 'none',
    default_setup: 'face', daily_post_quota: daily, pay_per_video_cents: 3500, monthly_pay_override_cents: null,
    pays_per_platform: false, needs_submission: false, post_position: null, cycle_size: null,
    opening_post_count: 0, brief_is_incomplete: false, created_at: stamp, updated_at: stamp,
  })
  await v7.table('campaign_accounts').add({
    id: accountId, user_id: USER, campaign_id: campaignId, platform: 'TikTok', handle: '@me', email: null,
    password: null, posts_per_day: 0, status: 'ready', is_active: true, bonus_only: false, sort_order: 0,
    created_at: stamp, updated_at: stamp,
  })
  v7.close()
  return { campaignId, accountId }
}

describe('campaigns saved before the weekly quota existed', () => {
  it('get per-day x 7, no payout date, and keep every other value', async () => {
    const { campaignId } = await seedOld(2)
    const db = new LocalDatabase(name)
    await db.open()
    const row = await db.campaigns.get(campaignId)
    expect(row?.posts_per_week).toBe(14)
    expect(row?.payout_schedule).toBe('none')
    expect(row?.payout_date).toBeNull()
    expect(row?.daily_post_quota).toBe(2)
    expect(row?.pay_per_video_cents).toBe(3500)
  })

  it('leave an account with no rate of its own, and can be edited afterwards', async () => {
    const { campaignId, accountId } = await seedOld(1)
    const db = new LocalDatabase(name)
    await db.open()
    expect((await db.campaign_accounts.get(accountId))?.pay_per_post_cents).toBeNull()

    const adapter = new LocalAdapter(db, USER)
    const edited = await adapter.updateCampaign(campaignId, { pay_per_video_cents: 4000 })
    expect(edited.posts_per_week).toBe(7)
    await expect(adapter.updateCampaignAccount(accountId, { pay_per_post_cents: 2500 })).resolves.toBeDefined()
  })

  it('open with the two new tables empty', async () => {
    await seedOld(1)
    const db = new LocalDatabase(name)
    await db.open()
    expect(await db.earnings_events.count()).toBe(0)
    expect(await db.campaign_payouts.count()).toBe(0)
  })
})
