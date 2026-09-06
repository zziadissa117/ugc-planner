// The v4 upgrade, tested against a real v3 database.
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

function fieldRow(campaignId: string, key: string, value: string | null) {
  return {
    id: crypto.randomUUID(),
    user_id: USER,
    campaign_id: campaignId,
    field_key: key,
    field_value: value,
    source: 'user_entered',
    source_quote: null,
    source_document_id: null,
    confirmed_at: null,
    updated_at: new Date().toISOString(),
  }
}

/** Runs the upgrade by opening the real database over the v3 one. */
async function upgrade(): Promise<LocalDatabase> {
  const db = new LocalDatabase(name)
  await db.open()
  return db
}

describe('deriving accounts from what he already entered', () => {
  it('derives one account per platform, with the handle he typed', async () => {
    const v3 = openV3()
    await v3.open()
    const campaign = campaignRow({ daily_post_quota: 1, opening_post_count: 13 })
    await v3.table('campaigns').add(campaign)
    await v3.table('campaign_fields').bulkAdd([
      fieldRow(campaign.id, 'platforms', 'TikTok, Instagram'),
      fieldRow(campaign.id, 'handle_tiktok', '@michael.financier'),
      fieldRow(campaign.id, 'handle_instagram', '@michael.financier'),
    ])
    v3.close()

    const db = await upgrade()
    const accounts = await db.campaign_accounts.where('campaign_id').equals(campaign.id).toArray()

    expect(accounts.map((a) => a.platform).sort()).toEqual(['Instagram', 'TikTok'])
    for (const account of accounts) {
      expect(account.handle).toBe('@michael.financier')
      // His own number, per account - never divided between them.
      expect(account.posts_per_day).toBe(1)
    }
  })

  it('splits a platforms field however he punctuated it, without duplicating', async () => {
    const v3 = openV3()
    await v3.open()
    const campaign = campaignRow()
    await v3.table('campaigns').add(campaign)
    await v3.table('campaign_fields').bulkAdd([
      // Listed lowercase with a plus, and implied again by the handle key.
      fieldRow(campaign.id, 'platforms', 'tiktok + instagram'),
      fieldRow(campaign.id, 'handle_tiktok', '@someone'),
    ])
    v3.close()

    const db = await upgrade()
    const accounts = await db.campaign_accounts.where('campaign_id').equals(campaign.id).toArray()

    // Two accounts, not three: "tiktok" listed and "handle_tiktok" implied are
    // the same account however they were capitalised.
    expect(accounts).toHaveLength(2)
    expect(accounts.map((a) => a.platform).sort()).toEqual(['Instagram', 'TikTok'])
    expect(accounts.find((a) => a.platform === 'TikTok')?.handle).toBe('@someone')
    // No handle was typed for Instagram, so none is guessed.
    expect(accounts.find((a) => a.platform === 'Instagram')?.handle).toBeNull()
  })

  it('never invents a handle for a platform that has none', async () => {
    const v3 = openV3()
    await v3.open()
    const campaign = campaignRow()
    await v3.table('campaigns').add(campaign)
    await v3.table('campaign_fields').add(fieldRow(campaign.id, 'platforms', 'YouTube'))
    v3.close()

    const db = await upgrade()
    const [account] = await db.campaign_accounts.where('campaign_id').equals(campaign.id).toArray()

    expect(account.platform).toBe('YouTube')
    expect(account.handle).toBeNull()
  })
})

describe('carrying warm-up status forward', () => {
  it('marks an account ready when posts were carried over', async () => {
    const v3 = openV3()
    await v3.open()
    const campaign = campaignRow({ opening_post_count: 13 })
    await v3.table('campaigns').add(campaign)
    await v3.table('campaign_fields').add(fieldRow(campaign.id, 'platforms', 'TikTok'))
    v3.close()

    const db = await upgrade()
    const [account] = await db.campaign_accounts.where('campaign_id').equals(campaign.id).toArray()
    expect(account.status).toBe('ready')
  })

  it('marks a campaign that has never posted as new, not ready', async () => {
    const v3 = openV3()
    await v3.open()
    // The bug this replaces marked everything 'ready', which emptied the
    // warm-up screen and treated a brand-new account as safe to post from.
    const campaign = campaignRow({ opening_post_count: 0 })
    await v3.table('campaigns').add(campaign)
    await v3.table('campaign_fields').add(fieldRow(campaign.id, 'platforms', 'TikTok'))
    v3.close()

    const db = await upgrade()
    const [account] = await db.campaign_accounts.where('campaign_id').equals(campaign.id).toArray()
    expect(account.status).toBe('new')
  })

  it('marks one completed warm-up session as warming, and two as ready', async () => {
    const v3 = openV3()
    await v3.open()
    const warming = campaignRow()
    const done = campaignRow()
    await v3.table('campaigns').bulkAdd([warming, done])
    await v3.table('campaign_fields').bulkAdd([
      fieldRow(warming.id, 'platforms', 'TikTok'),
      fieldRow(done.id, 'platforms', 'TikTok'),
    ])
    await v3.table('warmup_events').bulkAdd([
      { user_id: USER, campaign_id: warming.id, minutes: 30, occurred_at: new Date().toISOString(), client_id: crypto.randomUUID() },
      { user_id: USER, campaign_id: done.id, minutes: 30, occurred_at: new Date().toISOString(), client_id: crypto.randomUUID() },
      { user_id: USER, campaign_id: done.id, minutes: 30, occurred_at: new Date().toISOString(), client_id: crypto.randomUUID() },
    ])
    v3.close()

    const db = await upgrade()
    const [warmingAccount] = await db.campaign_accounts.where('campaign_id').equals(warming.id).toArray()
    const [doneAccount] = await db.campaign_accounts.where('campaign_id').equals(done.id).toArray()

    expect(warmingAccount.status).toBe('warming')
    expect(doneAccount.status).toBe('ready')
  })
})

describe('not losing anything on the way', () => {
  it('backfills updated_at so an old row still validates', async () => {
    const v3 = openV3()
    await v3.open()
    const campaign = campaignRow()
    await v3.table('campaigns').add(campaign)
    // Written before the column existed, exactly as his real rows were.
    await v3.table('campaign_rules').add({
      id: crypto.randomUUID(),
      user_id: USER,
      campaign_id: campaign.id,
      body: 'Never mix more than one angle into a video.',
      is_verified: true,
      sort_order: 1,
    })
    v3.close()

    const db = await upgrade()
    const [rule] = await db.campaign_rules.toArray()

    // Without this the column is `not null` and validated, so an export taken
    // today would fail its own import.
    expect(rule.updated_at).toEqual(expect.any(String))
  })

  it('leaves the legacy handle fields in place for review', async () => {
    const v3 = openV3()
    await v3.open()
    const campaign = campaignRow()
    await v3.table('campaigns').add(campaign)
    await v3.table('campaign_fields').add(fieldRow(campaign.id, 'handle_tiktok', '@someone'))
    v3.close()

    const db = await upgrade()
    const fields = await db.campaign_fields.toArray()

    // Deleting them would throw away the only record of what was derived from
    // what, before he has had a chance to check the accounts are right.
    expect(fields.find((f) => f.field_key === 'handle_tiktok')?.field_value).toBe('@someone')
  })

  it('does not duplicate accounts when the database is reopened', async () => {
    const v3 = openV3()
    await v3.open()
    const campaign = campaignRow()
    await v3.table('campaigns').add(campaign)
    await v3.table('campaign_fields').add(fieldRow(campaign.id, 'platforms', 'TikTok, Instagram'))
    v3.close()

    const first = await upgrade()
    expect(await first.campaign_accounts.count()).toBe(2)
    first.close()

    const second = await upgrade()
    expect(await second.campaign_accounts.count()).toBe(2)
  })

  it('opens the database even when deriving accounts fails', async () => {
    const v3 = openV3()
    await v3.open()
    // A campaign row missing the fields the derivation reads. Whatever it does
    // with this, the store has to open: a throw inside a Dexie upgrade aborts
    // the version change and the database never opens again on that device.
    await v3.table('campaigns').add({ id: crypto.randomUUID(), user_id: USER, name: 'Broken' })
    v3.close()

    const db = await upgrade()
    expect(db.isOpen()).toBe(true)
    expect(await db.campaigns.count()).toBe(1)
  })
})
