// The earnings history: what a tick pays, and that nothing already written is
// ever changed.

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  EARNINGS_HISTORY_START,
  deliverableCents,
  earnedOnDate,
  liveCheckoffs,
  netCents,
  paysPerPlatform,
  totalsBy,
  weekStart,
} from './earnings'
import { localToday } from './index'
import { LocalDatabase } from './local/db'
import { LocalAdapter } from './local/LocalAdapter'
import { buildBoard, markPosted, unmarkPosted } from './posting'
import type { Campaign, CampaignAccount, EarningsEvent } from './schema'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: LocalAdapter

function at(y: number, m: number, d: number, hour = 12) {
  vi.setSystemTime(new Date(y, m - 1, d, hour, 0, 0))
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  at(2026, 10, 5)
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`earnings-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})

afterEach(() => {
  vi.useRealTimers()
})

async function setUp(platforms: string[], overrides: Partial<Campaign> = {}) {
  const campaign = await adapter.createCampaign({
    name: 'Pump',
    company: null,
    default_setup: 'face',
    approval_mode: 'none',
    daily_post_quota: 1,
    pay_per_video_cents: 1600,
    cycle_size: null,
    ...overrides,
  })
  const accounts: CampaignAccount[] = []
  for (const platform of platforms) {
    accounts.push(
      await adapter.addCampaignAccount({
        campaign_id: campaign.id,
        platform,
        handle: '@me',
        status: 'ready',
      }),
    )
  }
  return { campaign, accounts }
}

async function tick(campaign: Campaign, account: CampaignAccount, slot = 0) {
  const videos = await adapter.listVideos({ campaignId: campaign.id })
  const posts = (await Promise.all(videos.map((v) => adapter.listVideoPosts(v.id)))).flat()
  const accounts = await adapter.listCampaignAccounts(campaign.id)
  const fresh = (await adapter.getCampaign(campaign.id)) as Campaign
  await markPosted(adapter, buildBoard(fresh, accounts, videos, posts), account, slot, videos)
}

async function untick(account: CampaignAccount, videoId?: string) {
  const videos = await adapter.listVideos()
  const id = videoId ?? videos[0].id
  const post = (await adapter.listVideoPosts(id)).find((p) => p.account_id === account.id)!
  await unmarkPosted(adapter, account, post)
}

describe('what a tick pays', () => {
  it('writes one checkoff for what the post paid, with its campaign and platform', async () => {
    const { campaign, accounts } = await setUp(['TikTok'])
    await tick(campaign, accounts[0])

    const events = await adapter.listEarningsEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      campaign_id: campaign.id,
      account_id: accounts[0].id,
      platform: 'TikTok',
      amount_cents: 1600,
      source: 'checkoff',
      earned_on: localToday(),
      reverses_id: null,
    })
  })

  it('gives each platform its own rate when he sets one', async () => {
    const { campaign, accounts } = await setUp(['TikTok', 'Instagram', 'YouTube'])
    await adapter.updateCampaignAccount(accounts[0].id, { pay_per_post_cents: 2500 })
    await adapter.updateCampaignAccount(accounts[1].id, { pay_per_post_cents: 1000 })
    // YouTube has none of its own, so the campaign's 1600 applies to it.
    for (const account of accounts) await tick(campaign, account)

    const byPlatform = Object.fromEntries(
      (await adapter.listEarningsEvents()).map((e) => [e.platform, e.amount_cents]),
    )
    expect(byPlatform).toEqual({ TikTok: 2500, Instagram: 1000, YouTube: 1600 })
    expect(await earned()).toBe(2500 + 1000 + 1600)
  })

  it('treats a rate typed on one platform as that campaign paying per platform', async () => {
    const { campaign, accounts } = await setUp(['TikTok', 'Instagram'])
    const before = await adapter.listCampaignAccounts(campaign.id)
    expect(paysPerPlatform(campaign, before)).toBe(false)

    await adapter.updateCampaignAccount(accounts[0].id, { pay_per_post_cents: 2500 })
    expect(paysPerPlatform(campaign, await adapter.listCampaignAccounts(campaign.id))).toBe(true)
  })

  it('splits one rate across platforms when nothing says they pay separately', async () => {
    const { campaign, accounts } = await setUp(['TikTok', 'Instagram', 'YouTube'], { pay_per_video_cents: 1000 })
    for (const account of accounts) await tick(campaign, account)

    const amounts = (await adapter.listEarningsEvents()).map((e) => e.amount_cents)
    // 1000 does not divide by three, and the running rounding still adds to it.
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(1000)
  })

  it('records nothing for a campaign with no rate - unpriced is not zero', async () => {
    const { campaign, accounts } = await setUp(['TikTok'], { pay_per_video_cents: null })
    await tick(campaign, accounts[0])
    expect(await adapter.listEarningsEvents()).toEqual([])
  })

  it('records nothing for an account paid only through bonuses', async () => {
    const { campaign, accounts } = await setUp(['YouTube', 'Facebook'])
    await adapter.updateCampaignAccount(accounts[1].id, { bonus_only: true })
    await tick(campaign, accounts[1])
    expect(await adapter.listEarningsEvents()).toEqual([])
  })
})

async function earned(date: string = localToday()) {
  return earnedOnDate(await adapter.listEarningsEvents(), date)
}

describe('the history is append-only', () => {
  it('takes a tick back with a reversal and leaves the checkoff exactly as it was', async () => {
    const { campaign, accounts } = await setUp(['TikTok'])
    await tick(campaign, accounts[0])
    const [original] = await adapter.listEarningsEvents()

    await untick(accounts[0])

    const events = await adapter.listEarningsEvents()
    expect(events).toHaveLength(2)
    // The first row is byte-for-byte what it was.
    expect(events.find((e) => e.id === original.id)).toEqual(original)
    const reversal = events.find((e) => e.source === 'reversal')!
    expect(reversal).toMatchObject({ amount_cents: -1600, reverses_id: original.id })
    expect(netCents(events)).toBe(0)
    expect(liveCheckoffs(events)).toEqual([])
  })

  it("dates a reversal on the day it happens, so a past day's total does not move", async () => {
    const { campaign, accounts } = await setUp(['TikTok'])
    await tick(campaign, accounts[0])
    const posted = localToday()

    at(2026, 10, 6)
    await untick(accounts[0])

    expect(await earned(posted)).toBe(1600) // Monday's money is still Monday's
    expect(await earned('2026-10-06')).toBe(-1600) // the takeback is Tuesday's
  })

  it('pays again when the box is ticked again, as a new row', async () => {
    const { campaign, accounts } = await setUp(['TikTok'])
    await tick(campaign, accounts[0])
    await untick(accounts[0])
    await tick(campaign, accounts[0])

    const events = await adapter.listEarningsEvents()
    expect(events.filter((e) => e.source === 'checkoff')).toHaveLength(2)
    expect(netCents(events)).toBe(1600)
    expect(liveCheckoffs(events)).toHaveLength(1)
  })

  it('does not reprice a past tick when the rate changes', async () => {
    const { campaign, accounts } = await setUp(['TikTok'])
    await tick(campaign, accounts[0])
    await adapter.updateCampaign(campaign.id, { pay_per_video_cents: 9900 })
    await adapter.updateCampaignAccount(accounts[0].id, { pay_per_post_cents: 7700 })
    expect(await earned()).toBe(1600)
  })

  it('does not undo a tick on one platform when it is the other that is taken down', async () => {
    const { campaign, accounts } = await setUp(['TikTok', 'Instagram'], { pays_per_platform: true })
    await tick(campaign, accounts[0])
    await tick(campaign, accounts[1])
    await untick(accounts[1])
    expect(await earned()).toBe(1600)
  })
})

describe('days before the history starts', () => {
  it('start on 2026-10-01 and earlier ticks are not recorded', async () => {
    expect(EARNINGS_HISTORY_START).toBe('2026-10-01')
    at(2026, 9, 30)
    const { campaign, accounts } = await setUp(['TikTok'])
    await tick(campaign, accounts[0])
    expect(await adapter.listEarningsEvents()).toEqual([])
  })
})

describe('backfilling ticks that predate the history', () => {
  async function postWithoutHistory(account: CampaignAccount, campaign: Campaign) {
    // Written the way the app wrote it before the history existed: the post
    // and the video, and no earnings row.
    const video = await adapter.createVideo({
      campaign_id: campaign.id,
      setup: 'face',
      angle_id: null,
      script: null,
      blocked_reason: null,
      owed_for_date: localToday(),
      rate_snapshot_cents: null,
      posted_at: null,
    })
    const db = (adapter as unknown as { db: LocalDatabase }).db
    await db.video_posts.add({
      id: crypto.randomUUID(),
      user_id: USER,
      video_id: video.id,
      account_id: account.id,
      platform: account.platform,
      url: null,
      posted_at: new Date().toISOString(),
      view_count: null,
      view_count_entered_at: null,
      updated_at: new Date().toISOString(),
    })
  }

  it('writes the missing rows once, and only once', async () => {
    const { campaign, accounts } = await setUp(['TikTok'])
    await postWithoutHistory(accounts[0], campaign)
    expect(await adapter.listEarningsEvents()).toEqual([])

    expect(await adapter.backfillEarningsHistory()).toBe(1)
    expect(await earned()).toBe(1600)

    expect(await adapter.backfillEarningsHistory()).toBe(0)
    expect(await adapter.listEarningsEvents()).toHaveLength(1)
  })

  it("uses the post's own id, so two devices cannot pay it twice", async () => {
    const { campaign, accounts } = await setUp(['TikTok'])
    await postWithoutHistory(accounts[0], campaign)
    await adapter.backfillEarningsHistory()

    const [event] = await adapter.listEarningsEvents()
    const post = (await adapter.listAllVideoPosts())[0]
    expect(event.id).toBe(post.id)
  })

  it('queues what it writes for the server', async () => {
    const { campaign, accounts } = await setUp(['TikTok'])
    await postWithoutHistory(accounts[0], campaign)
    const before = (await adapter.listPendingWrites()).filter((w) => w.table_name === 'earnings_events')
    await adapter.backfillEarningsHistory()
    const after = (await adapter.listPendingWrites()).filter((w) => w.table_name === 'earnings_events')
    expect(after.length - before.length).toBe(1)
    expect(after.at(-1)?.op).toBe('insert')
  })
})

describe('every earnings write is queued for the server', () => {
  it('queues the checkoff and the reversal as inserts', async () => {
    const { campaign, accounts } = await setUp(['TikTok'])
    await tick(campaign, accounts[0])
    await untick(accounts[0])
    const queued = (await adapter.listPendingWrites()).filter((w) => w.table_name === 'earnings_events')
    expect(queued.map((w) => w.op)).toEqual(['insert', 'insert'])
  })
})

describe('totals', () => {
  const ev = (earned_on: string, amount_cents: number, id = crypto.randomUUID()): EarningsEvent => ({
    id,
    user_id: USER,
    campaign_id: 'c',
    video_id: 'v',
    account_id: 'a',
    platform: 'TikTok',
    amount_cents,
    source: amount_cents < 0 ? 'reversal' : 'checkoff',
    earned_on,
    reverses_id: amount_cents < 0 ? 'x' : null,
    occurred_at: `${earned_on}T12:00:00.000Z`,
  })

  it('finds the Monday of a week, across a month boundary', () => {
    expect(weekStart('2026-10-05')).toBe('2026-10-05') // a Monday
    expect(weekStart('2026-10-11')).toBe('2026-10-05') // the Sunday after
    expect(weekStart('2026-10-01')).toBe('2026-09-28') // Thursday, back into September
  })

  it('adds by day, week and month, newest first, with reversals netted', () => {
    const events = [
      ev('2026-10-01', 1000),
      ev('2026-10-02', 2000),
      ev('2026-10-06', 3000),
      ev('2026-10-06', -500),
      ev('2026-11-02', 4000),
    ]
    expect(totalsBy(events, 'day')).toEqual([
      { key: '2026-11-02', cents: 4000 },
      { key: '2026-10-06', cents: 2500 },
      { key: '2026-10-02', cents: 2000 },
      { key: '2026-10-01', cents: 1000 },
    ])
    expect(totalsBy(events, 'week')).toEqual([
      { key: '2026-11-02', cents: 4000 },
      { key: '2026-10-05', cents: 2500 },
      { key: '2026-09-28', cents: 3000 },
    ])
    expect(totalsBy(events, 'month')).toEqual([
      { key: '2026-11', cents: 4000 },
      { key: '2026-10', cents: 5500 },
    ])
  })
})

describe('what a deliverable is worth', () => {
  const campaign = (over: Partial<Campaign> = {}) =>
    ({ id: 'c', pay_per_video_cents: 1600, pays_per_platform: false, ...over }) as Campaign
  const account = (id: string, pay: number | null): CampaignAccount =>
    ({
      id,
      campaign_id: 'c',
      platform: id,
      is_active: true,
      bonus_only: false,
      status: 'ready',
      pay_per_post_cents: pay,
    }) as CampaignAccount

  it('is the campaign rate once when platforms share it', () => {
    expect(deliverableCents(campaign(), [account('a', null), account('b', null)])).toBe(1600)
  })

  it('adds each platform up when they pay separately', () => {
    expect(
      deliverableCents(campaign(), [account('a', 2500), account('b', 1000), account('c', null)]),
    ).toBe(2500 + 1000 + 1600)
  })

  it('is unknown, not zero, with no rate anywhere', () => {
    expect(deliverableCents(campaign({ pay_per_video_cents: null }), [account('a', null)])).toBeNull()
  })
})
