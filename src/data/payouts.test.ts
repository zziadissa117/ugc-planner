import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import { LocalDatabase } from './local/db'
import { LocalAdapter } from './local/LocalAdapter'
import { payoutStatus } from './payouts'
import type { CampaignPayout, PayoutSchedule } from './schema'

const USER = '11111111-1111-4111-8111-111111111111'

const campaign = (payout_schedule: PayoutSchedule, payout_date: string | null) => ({
  id: 'c1',
  payout_schedule,
  payout_date,
})
const paid = (due_date: string): CampaignPayout => ({
  id: crypto.randomUUID(),
  user_id: USER,
  campaign_id: 'c1',
  due_date,
  paid_at: '2026-10-20T00:00:00.000Z',
  received_cents: null,
  updated_at: '2026-10-20T00:00:00.000Z',
})

describe('payoutStatus', () => {
  it('says nothing when no payout date is saved', () => {
    expect(payoutStatus(campaign('none', null), [], '2026-10-02')).toBeNull()
    expect(payoutStatus(campaign('monthly', null), [], '2026-10-02')).toBeNull()
  })

  it('is upcoming before a one-off payout, and not overdue', () => {
    expect(payoutStatus(campaign('one_off', '2026-10-15'), [], '2026-10-02')).toEqual({
      latest: null,
      next: '2026-10-15',
      overdue: false,
    })
  })

  it('is pending and overdue once a one-off date passes unpaid, and settled when marked', () => {
    const c = campaign('one_off', '2026-10-15')
    const pending = payoutStatus(c, [], '2026-10-20')!
    expect(pending.latest).toEqual({ dueDate: '2026-10-15', paid: null })
    expect(pending.overdue).toBe(true)
    expect(pending.next).toBeNull()

    const settled = payoutStatus(c, [paid('2026-10-15')], '2026-10-20')!
    expect(settled.latest?.paid).not.toBeNull()
    expect(settled.overdue).toBe(false)
  })

  it('walks a monthly schedule, clamping the 31st into short months', () => {
    const c = campaign('monthly', '2026-01-31')
    expect(payoutStatus(c, [], '2026-02-27')!.next).toBe('2026-02-28')
    // Anchored on the 31st, March is the 31st again - not the 28th.
    expect(payoutStatus(c, [], '2026-03-05')!.latest?.dueDate).toBe('2026-02-28')
    expect(payoutStatus(c, [], '2026-03-05')!.next).toBe('2026-03-31')
  })

  it('tracks each recurrence on its own', () => {
    const c = campaign('weekly', '2026-10-01')
    // Today is the 9th: the 8th is the latest due. Paying the 1st does not pay the 8th.
    const status = payoutStatus(c, [paid('2026-10-01')], '2026-10-09')!
    expect(status.latest?.dueDate).toBe('2026-10-08')
    expect(status.latest?.paid).toBeNull()
    expect(status.overdue).toBe(true)
    expect(status.next).toBe('2026-10-15')
  })

  it('steps every two weeks', () => {
    const status = payoutStatus(campaign('biweekly', '2026-10-01'), [], '2026-10-20')!
    expect(status.latest?.dueDate).toBe('2026-10-15')
    expect(status.next).toBe('2026-10-29')
  })

  it('stops chasing a payout that is months stale', () => {
    const status = payoutStatus(campaign('one_off', '2026-01-01'), [], '2026-10-02')!
    expect(status.overdue).toBe(false)
  })
})

describe('marking a payout', () => {
  let adapter: LocalAdapter
  beforeEach(async () => {
    indexedDB = new IDBFactory()
    const db = new LocalDatabase(`payouts-${crypto.randomUUID()}`)
    adapter = new LocalAdapter(db, USER)
    await db.open()
  })

  async function make() {
    return adapter.createCampaign({
      name: 'Pump',
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      pay_per_video_cents: 1600,
      cycle_size: null,
      payout_schedule: 'monthly',
      payout_date: '2026-10-15',
    })
  }

  it('records it, with what arrived only when he says', async () => {
    const campaign = await make()
    const row = await adapter.markPayoutPaid(campaign.id, '2026-10-15')
    expect(row).toMatchObject({ campaign_id: campaign.id, due_date: '2026-10-15', received_cents: null })
    const again = await adapter.markPayoutPaid(campaign.id, '2026-10-15', 45000)
    expect(again.id).toBe(row.id)
    expect(again.received_cents).toBe(45000)
    expect(await adapter.listCampaignPayouts(campaign.id)).toHaveLength(1)
  })

  it('goes back to pending, and queues both changes', async () => {
    const campaign = await make()
    await adapter.markPayoutPaid(campaign.id, '2026-10-15')
    await adapter.unmarkPayoutPaid(campaign.id, '2026-10-15')
    expect(await adapter.listCampaignPayouts(campaign.id)).toEqual([])
    const ops = (await adapter.listPendingWrites())
      .filter((w) => w.table_name === 'campaign_payouts')
      .map((w) => w.op)
    expect(ops).toEqual(['insert', 'delete'])
  })

  it('refuses a payout for a campaign that is not there', async () => {
    await expect(adapter.markPayoutPaid('nope', '2026-10-15')).rejects.toThrow()
  })
})

describe('the weekly quota', () => {
  let adapter: LocalAdapter
  beforeEach(async () => {
    indexedDB = new IDBFactory()
    const db = new LocalDatabase(`weekly-${crypto.randomUUID()}`)
    adapter = new LocalAdapter(db, USER)
    await db.open()
  })
  const base = { name: 'X', company: null, default_setup: 'face' as const, approval_mode: 'none' as const, pay_per_video_cents: 100, cycle_size: null }

  it('derives the weekly quota from a daily one, for anything that still speaks per-day', async () => {
    const c = await adapter.createCampaign({ ...base, daily_post_quota: 2 })
    expect(c).toMatchObject({ daily_post_quota: 2, posts_per_week: 14 })
    const edited = await adapter.updateCampaign(c.id, { daily_post_quota: 3 })
    expect(edited).toMatchObject({ daily_post_quota: 3, posts_per_week: 21 })
  })

  it('owes ceil(weekly / 7) a day when he sets it per week', async () => {
    const c = await adapter.createCampaign({ ...base, posts_per_week: 5 })
    expect(c).toMatchObject({ posts_per_week: 5, daily_post_quota: 1 })
    expect(await adapter.updateCampaign(c.id, { posts_per_week: 15 })).toMatchObject({
      posts_per_week: 15,
      daily_post_quota: 3,
    })
    expect(await adapter.updateCampaign(c.id, { posts_per_week: 0 })).toMatchObject({
      posts_per_week: 0,
      daily_post_quota: 0,
    })
  })

  it('leaves both alone when an edit touches neither', async () => {
    const c = await adapter.createCampaign({ ...base, posts_per_week: 5 })
    expect(await adapter.updateCampaign(c.id, { name: 'Renamed' })).toMatchObject({
      posts_per_week: 5,
      daily_post_quota: 1,
    })
  })
})
