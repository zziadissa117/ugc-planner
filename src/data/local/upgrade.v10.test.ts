// The v10 upgrade: every table gets the columns an older build never wrote,
// filled the way the database would fill them. v5-v9 each covered one
// column; the ones nobody wrote an upgrade for (archived_at,
// cutter_campaign_id, post_position, pay_per_post_cents, view_count...) came
// back undefined and crashed the screens that formatted them.

import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import { LocalDatabase } from './db'

const USER = '11111111-1111-4111-8111-111111111111'
let name: string

beforeEach(() => {
  indexedDB = new IDBFactory()
  name = `upgrade-v10-${crypto.randomUUID()}`
})

function openV9(): Dexie {
  const db = new Dexie(name)
  db.version(9).stores({
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

describe('rows written before their newer columns existed', () => {
  it('get every missing column filled, on every table, and keep what they had', async () => {
    const v9 = openV9()
    await v9.open()
    const campaignId = crypto.randomUUID()
    const accountId = crypto.randomUUID()
    const videoId = crypto.randomUUID()
    await v9.table('campaigns').add({
      id: campaignId, user_id: USER, name: 'Vertus', company: null, is_active: true, approval_mode: 'none',
      default_setup: 'face', daily_post_quota: 2, pay_per_video_cents: 3500, cycle_size: null,
      opening_post_count: 0, brief_is_incomplete: false, created_at: stamp, updated_at: stamp,
      // Set, so it must stay: the fill only ever adds.
      pays_per_platform: true,
    })
    await v9.table('campaign_accounts').add({
      id: accountId, user_id: USER, campaign_id: campaignId, platform: 'TikTok', handle: '@v',
      posts_per_day: 0, status: 'ready', is_active: true, sort_order: 0, created_at: stamp, updated_at: stamp,
    })
    await v9.table('videos').add({
      id: videoId, user_id: USER, campaign_id: campaignId, kind: 'contracted', setup: null, angle_id: null,
      phase: 'posted', owed_for_date: null, posted_at: stamp, created_at: stamp, updated_at: stamp,
    })
    await v9.table('video_posts').add({
      id: crypto.randomUUID(), user_id: USER, video_id: videoId, account_id: accountId, platform: 'TikTok',
      posted_at: stamp, updated_at: stamp,
    })
    v9.close()

    const db = new LocalDatabase(name)
    await db.open()
    const campaign = await db.campaigns.get(campaignId)
    expect(campaign).toMatchObject({
      min_views: null, archived_at: null, cutter_campaign_id: null, post_position: null, payout_date: null,
      monthly_pay_override_cents: null, needs_submission: false, payout_schedule: 'none', posts_per_week: 14,
      pays_per_platform: true, pay_per_video_cents: 3500,
    })
    expect(await db.campaign_accounts.get(accountId)).toMatchObject({ bonus_only: false, pay_per_post_cents: null, email: null, password: null, handle: '@v' })
    expect(await db.videos.get(videoId)).toMatchObject({ script: null, blocked_reason: null, rate_snapshot_cents: null, phase: 'posted' })
    const [post] = await db.video_posts.toArray()
    expect(post).toMatchObject({ url: null, view_count: null, view_count_entered_at: null })
  })
})
