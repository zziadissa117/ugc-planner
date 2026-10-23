// Rows that arrive without their newer columns - a backup exported by an
// older build, a row pulled from a server provisioned before a column
// existed - are filled in rather than refused or stored half-made.

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import { LocalDatabase } from './db'
import { BACKUP_FORMAT_VERSION, LocalAdapter } from './LocalAdapter'

const USER = '11111111-1111-4111-8111-111111111111'
const stamp = '2026-10-08T02:40:12.210Z'

let adapter: LocalAdapter
let db: LocalDatabase

beforeEach(async () => {
  indexedDB = new IDBFactory()
  db = new LocalDatabase(`old-rows-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})

/** A campaign as an export from early October held it: no min_views, no
 *  archive, no cutter link, no post order, no weekly rate columns. */
const OLD_CAMPAIGN = {
  id: '6f9c0d1e-0000-4000-8000-000000000001',
  user_id: USER,
  name: 'Lock In',
  company: null,
  is_active: true,
  approval_mode: 'none',
  default_setup: 'face',
  daily_post_quota: 1,
  pay_per_video_cents: 1675,
  cycle_size: null,
  monthly_pay_override_cents: null,
  pays_per_platform: false,
  needs_submission: true,
  opening_post_count: 0,
  brief_is_incomplete: false,
  created_at: stamp,
  updated_at: stamp,
}

describe('restoring a backup from an older build', () => {
  it('fills the missing columns and the campaign reads back whole', async () => {
    const result = await adapter.importAll({
      format_version: BACKUP_FORMAT_VERSION,
      exported_at: stamp,
      campaigns: [OLD_CAMPAIGN],
      campaign_accounts: [
        {
          id: '6f9c0d1e-0000-4000-8000-000000000002', user_id: USER, campaign_id: OLD_CAMPAIGN.id, platform: 'TikTok',
          handle: 'lockinwithziad', posts_per_day: 0, status: 'ready', is_active: true, sort_order: 0,
          created_at: stamp, updated_at: stamp,
        },
      ],
    })
    expect(result.counts.campaigns).toBe(1)
    const campaign = await adapter.getCampaign(OLD_CAMPAIGN.id)
    expect(campaign).toMatchObject({
      min_views: null, archived_at: null, cutter_campaign_id: null, post_position: null,
      payout_schedule: 'none', payout_date: null, posts_per_week: 7, needs_submission: true,
    })
    const [account] = await adapter.listCampaignAccounts(OLD_CAMPAIGN.id)
    expect(account).toMatchObject({ bonus_only: false, pay_per_post_cents: null, email: null, password: null })
    // It is a normal campaign from here on: an edit goes through.
    await expect(adapter.updateCampaign(OLD_CAMPAIGN.id, { pay_per_video_cents: 1700 })).resolves.toMatchObject({ pay_per_video_cents: 1700 })
  })
})

describe('a row pulled from the server without some columns', () => {
  it('keeps what this device holds for them, and defaults the rest', async () => {
    const created = await adapter.createCampaign({
      id: OLD_CAMPAIGN.id, name: 'Lock In', company: null, default_setup: 'face', approval_mode: 'none',
      daily_post_quota: 1, pay_per_video_cents: 1675, cycle_size: null,
    })
    await adapter.updateCampaign(created.id, { min_views: 500, pays_per_platform: true })

    await adapter.applyRemoteRow('campaigns', { ...OLD_CAMPAIGN, name: 'Lock In (server)' })
    const campaign = await adapter.getCampaign(created.id)
    expect(campaign?.name).toBe('Lock In (server)')
    // The server said nothing about these, so they stay.
    expect(campaign?.min_views).toBe(500)
    expect(campaign?.pays_per_platform).toBe(false) // sent as false by the server: that is an opinion
    expect(campaign?.posts_per_week).toBe(7)

    // A row this device has never seen gets the defaults, not undefined.
    const other = { ...OLD_CAMPAIGN, id: '6f9c0d1e-0000-4000-8000-000000000009', name: 'Vaza' }
    await adapter.applyRemoteRow('campaigns', other)
    const fresh = await adapter.getCampaign(other.id)
    expect(fresh).toHaveProperty('min_views', null)
    expect(fresh).toHaveProperty('archived_at', null)
    expect(fresh).toHaveProperty('post_position', null)
    expect(fresh?.payout_schedule).toBe('none')
  })
})
