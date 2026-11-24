// The v13 upgrade: trybe_videos and ideate_notes arrive as two new, empty
// tables. A store at v12 - plan_blocks and side_income already in it - opens
// with everything it had, and the new tables answer reads, writes and the
// backup straight away.

import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import { LocalAdapter } from './LocalAdapter'
import { LocalDatabase, MIRRORED_TABLES } from './db'

const USER = '11111111-1111-4111-8111-111111111111'
let name: string

beforeEach(() => {
  indexedDB = new IDBFactory()
  name = `upgrade-v13-${crypto.randomUUID()}`
})

/** The store exactly as v12 left it. */
function openV12(): Dexie {
  const db = new Dexie(name)
  db.version(12).stores({
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
    side_income: 'id, user_id, earned_on',
    plan_blocks: 'id, user_id',
  })
  return db
}

const stamp = new Date().toISOString()

describe('a v12 store opened by v13', () => {
  it('keeps every row it had and gains the two new tables, empty', async () => {
    const v12 = openV12()
    await v12.open()
    const campaignId = crypto.randomUUID()
    const accountId = crypto.randomUUID()
    const blockId = crypto.randomUUID()
    const incomeId = crypto.randomUUID()
    await v12.table('campaigns').add({
      id: campaignId, user_id: USER, name: 'Vertus', company: null, is_active: true, approval_mode: 'none',
      default_setup: 'face', daily_post_quota: 1, posts_per_week: 7, pay_per_video_cents: 3500, cycle_size: null,
      opening_post_count: 0, brief_is_incomplete: false, created_at: stamp, updated_at: stamp,
    })
    await v12.table('campaign_accounts').add({
      id: accountId, user_id: USER, campaign_id: campaignId, platform: 'TikTok', handle: '@v',
      posts_per_day: 0, status: 'ready', is_active: true, sort_order: 0, created_at: stamp, updated_at: stamp,
    })
    await v12.table('plan_blocks').add({
      id: blockId, user_id: USER, kind: 'record', weekday: 0, start_minute: 18 * 60, duration_minutes: 120, updated_at: stamp,
    })
    await v12.table('side_income').add({
      id: incomeId, user_id: USER, source: 'detailing', amount_cents: 18000, currency: 'CAD', earned_on: '2026-11-02',
      created_at: stamp, updated_at: stamp,
    })
    v12.close()

    const db = new LocalDatabase(name)
    await db.open()
    // At least 13: later versions open the same store on top of it.
    expect(db.verno).toBeGreaterThanOrEqual(13)
    expect(await db.plan_blocks.get(blockId)).toMatchObject({ kind: 'record', duration_minutes: 120 })
    expect(await db.side_income.get(incomeId)).toMatchObject({ amount_cents: 18000 })
    expect(await db.campaigns.get(campaignId)).toMatchObject({ name: 'Vertus' })
    expect(await db.trybe_videos.count()).toBe(0)
    expect(await db.ideate_notes.count()).toBe(0)
    expect(MIRRORED_TABLES).toEqual(expect.arrayContaining(['trybe_videos', 'ideate_notes']))

    // Writable and indexed the way the adapter reads them.
    const adapter = new LocalAdapter(db, USER)
    await adapter.logTrybeVideo()
    await adapter.saveIdeateNote({ campaign_id: campaignId, account_id: accountId, week_start: '2026-11-22', body: 'Hook 2 held' })
    expect(await db.ideate_notes.where('[campaign_id+week_start]').equals([campaignId, '2026-11-22']).count()).toBe(1)
    const backup = await adapter.exportAll()
    expect(backup.trybe_videos).toHaveLength(1)
    expect(backup.ideate_notes).toHaveLength(1)
    expect(backup.plan_blocks).toHaveLength(1)
  })
})
