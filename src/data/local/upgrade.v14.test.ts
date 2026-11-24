// The v14 upgrade: coach_notes arrives as a new, empty table. A store at v13 -
// trybe_videos and ideate_notes already in it - opens with everything it had,
// and the new table takes pulled rows, answers listCoachNotes and goes into
// the backup straight away, without a single write queued for it.

import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import { LocalAdapter } from './LocalAdapter'
import { LocalDatabase, MIRRORED_TABLES, PULL_ONLY_TABLES } from './db'

const USER = '11111111-1111-4111-8111-111111111111'
const COACH = '22222222-2222-4222-8222-222222222222'
let name: string

beforeEach(() => {
  indexedDB = new IDBFactory()
  name = `upgrade-v14-${crypto.randomUUID()}`
})

/** The store exactly as v13 left it. */
function openV13(): Dexie {
  const db = new Dexie(name)
  db.version(13).stores({
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
    trybe_videos: 'id, user_id, made_at',
    ideate_notes: 'id, user_id, campaign_id, account_id, week_start, [campaign_id+week_start]',
  })
  return db
}

const stamp = new Date().toISOString()

describe('a v13 store opened by v14', () => {
  it('keeps every row it had and gains coach_notes, empty and pull-only', async () => {
    const v13 = openV13()
    await v13.open()
    const campaignId = crypto.randomUUID()
    const trybeId = crypto.randomUUID()
    const ideateId = crypto.randomUUID()
    await v13.table('campaigns').add({
      id: campaignId, user_id: USER, name: 'Vertus', company: null, is_active: true, approval_mode: 'none',
      default_setup: 'face', daily_post_quota: 1, posts_per_week: 7, pay_per_video_cents: 3500, cycle_size: null,
      opening_post_count: 0, brief_is_incomplete: false, created_at: stamp, updated_at: stamp,
    })
    await v13.table('trybe_videos').add({ id: trybeId, user_id: USER, made_at: stamp, updated_at: stamp })
    await v13.table('ideate_notes').add({
      id: ideateId, user_id: USER, campaign_id: campaignId, account_id: null, week_start: '2026-11-22',
      body: 'Hook 2 held', created_at: stamp, updated_at: stamp,
    })
    v13.close()

    const db = new LocalDatabase(name)
    await db.open()
    expect(db.verno).toBe(14)
    expect(await db.campaigns.get(campaignId)).toMatchObject({ name: 'Vertus' })
    expect(await db.trybe_videos.get(trybeId)).toMatchObject({ user_id: USER })
    expect(await db.ideate_notes.get(ideateId)).toMatchObject({ body: 'Hook 2 held' })
    expect(await db.coach_notes.count()).toBe(0)
    expect(MIRRORED_TABLES).toContain('coach_notes')
    expect(PULL_ONLY_TABLES.has('coach_notes')).toBe(true)

    // A pulled note lands, is indexed the way listCoachNotes reads it, and
    // goes into the backup - and nothing is queued for it.
    const adapter = new LocalAdapter(db, USER)
    await adapter.applyRemoteRow('coach_notes', {
      id: crypto.randomUUID(),
      user_id: USER,
      author_id: COACH,
      campaign_id: campaignId,
      post_id: null,
      post_url: null,
      week_start: '2026-11-22',
      body: 'Open on the product next week',
      created_at: '2026-11-24T19:00:00.123456+00:00',
      updated_at: '2026-11-24T19:00:00.123456+00:00',
    })
    expect(await db.coach_notes.where('campaign_id').equals(campaignId).count()).toBe(1)
    expect(await adapter.listCoachNotes({ campaignId })).toHaveLength(1)
    const backup = await adapter.exportAll()
    expect(backup.coach_notes).toHaveLength(1)
    expect(backup.ideate_notes).toHaveLength(1)
    expect(await db._outbox.where('table_name').equals('coach_notes').count()).toBe(0)
  })
})
