// The v9 upgrade: campaigns saved before the views tracker have no min_views
// at all, and the screens' `min_views === null` checks read undefined as a
// minimum and crashed formatting it. They get null - "no minimum".

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
  name = `upgrade-v9-${crypto.randomUUID()}`
})

function openV8(): Dexie {
  const db = new Dexie(name)
  db.version(8).stores({
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
    earnings_events: 'id, campaign_id, video_id, earned_on, reverses_id',
    campaign_payouts: 'id, campaign_id, &[campaign_id+due_date]',
  })
  return db
}

const stamp = new Date().toISOString()

async function seedOld(extra: Record<string, unknown> = {}) {
  const v8 = openV8()
  await v8.open()
  const campaignId = crypto.randomUUID()
  await v8.table('campaigns').add({
    id: campaignId, user_id: USER, name: 'Vertus', company: null, is_active: true, approval_mode: 'none',
    default_setup: 'face', daily_post_quota: 2, posts_per_week: 14, pay_per_video_cents: 3500,
    monthly_pay_override_cents: null, pays_per_platform: false, needs_submission: false, post_position: null,
    cutter_campaign_id: null, payout_schedule: 'none', payout_date: null, cycle_size: null,
    opening_post_count: 0, brief_is_incomplete: false, archived_at: null, created_at: stamp, updated_at: stamp,
    ...extra,
  })
  v8.close()
  return campaignId
}

describe('campaigns saved before the views tracker', () => {
  it('get no minimum, null rather than missing', async () => {
    const campaignId = await seedOld()
    const db = new LocalDatabase(name)
    await db.open()
    const row = await db.campaigns.get(campaignId)
    expect(row).toHaveProperty('min_views', null)
    expect(row?.pay_per_video_cents).toBe(3500)
  })

  it('keep a minimum that is already there', async () => {
    const campaignId = await seedOld({ min_views: 1000 })
    const db = new LocalDatabase(name)
    await db.open()
    expect((await db.campaigns.get(campaignId))?.min_views).toBe(1000)
  })

  it('can be given a minimum afterwards', async () => {
    const campaignId = await seedOld()
    const db = new LocalDatabase(name)
    await db.open()
    const edited = await new LocalAdapter(db, USER).updateCampaign(campaignId, { min_views: 500 })
    expect(edited.min_views).toBe(500)
  })
})
