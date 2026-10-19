import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataAdapter } from '.'
import { accountFor, applyCutterPosts, platformRoot, scheduledByAccount, videoLink, type CutterPost, suggestCutterLinks } from './cutterBridge'
import { LocalDatabase } from './local/db'
import { LocalAdapter } from './local/LocalAdapter'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: DataAdapter

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 5, 12, 0, 0))
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`bridge-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})
afterEach(() => vi.useRealTimers())

async function linked(platforms: string[], cutterId: string | null = 'cut-1', handle: string | null = '@me', quota = 1) {
  const campaign = await adapter.createCampaign({
    name: 'Inflow',
    company: null,
    default_setup: 'face',
    approval_mode: 'none',
    daily_post_quota: quota,
    pay_per_video_cents: 1600,
    cycle_size: null,
    cutter_campaign_id: cutterId,
  })
  for (const platform of platforms) {
    await adapter.addCampaignAccount({ campaign_id: campaign.id, platform, handle, status: 'ready' })
  }
  return campaign
}

const post = (over: Partial<CutterPost> = {}): CutterPost => ({
  id: 'p1',
  campaignId: 'cut-1',
  campaignName: 'Inflow',
  accounts: [{ name: 'Me | Creator', profile: 'me', platform: 'tiktok' }],
  links: {},
  postedAt: new Date(2026, 9, 5, 9, 0, 0).toISOString(),
  ...over,
})

describe('platformRoot', () => {
  it('matches the cutter and planner spellings', () => {
    expect(platformRoot('tiktok-business')).toBe('tiktok')
    expect(platformRoot('TikTok')).toBe('tiktok')
    expect(platformRoot('instagram-standalone')).toBe('instagram')
    expect(platformRoot('YouTube')).toBe('youtube')
  })
})

describe('applyCutterPosts', () => {
  it('ticks the matching box and posts the deliverable once', async () => {
    const campaign = await linked(['TikTok', 'Instagram'])
    expect((await applyCutterPosts(adapter, [post()])).ticked).toBe(1)
    const posts = await adapter.listAllVideoPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].platform).toBe('TikTok')
    expect(posts[0].url).toBe('cutter:p1:tiktok')
    const videos = await adapter.listVideos({ campaignId: campaign.id })
    expect(videos.filter((v) => v.phase === 'posted')).toHaveLength(1)
  })

  it('is idempotent: the same post twice ticks once', async () => {
    await linked(['TikTok'])
    await applyCutterPosts(adapter, [post()])
    expect((await applyCutterPosts(adapter, [post()])).ticked).toBe(0)
    expect(await adapter.listAllVideoPosts()).toHaveLength(1)
  })

  it('one post to two platforms is one deliverable with two destinations', async () => {
    const campaign = await linked(['TikTok', 'Instagram'])
    await applyCutterPosts(adapter, [
      post({ accounts: [{ name: 'a', profile: 'me', platform: 'tiktok' }, { name: 'b', profile: 'me', platform: 'instagram' }] }),
    ])
    const posts = await adapter.listAllVideoPosts()
    expect(posts).toHaveLength(2)
    expect(new Set(posts.map((p) => p.video_id)).size).toBe(1)
    expect((await adapter.listVideos({ campaignId: campaign.id })).filter((v) => v.phase === 'posted')).toHaveLength(1)
  })

  it('uses the platform link when the cutter has one', async () => {
    await linked(['TikTok'])
    await applyCutterPosts(adapter, [post({ links: { 'Me | Creator': 'https://tiktok.com/@me/video/1' } })])
    expect((await adapter.listAllVideoPosts())[0].url).toBe('https://tiktok.com/@me/video/1')
  })

  it('leaves unlinked campaigns and platforms with no account alone', async () => {
    await linked(['TikTok'], null)
    expect((await applyCutterPosts(adapter, [post()])).ticked).toBe(0)
    await linked(['Instagram'])
    expect((await applyCutterPosts(adapter, [post()])).ticked).toBe(0)
    expect(await adapter.listAllVideoPosts()).toHaveLength(0)
  })
})

describe('the accounts it really went to', () => {
  const account = (platform: string, handle: string | null) => ({ id: `${platform}-${handle}`, platform, handle })

  it('finds the account by its handle, never another on the same platform', () => {
    const lockIn = [account('Instagram', 'karimsnn1'), account('TikTok', 'danny.snoozed')]
    expect(accountFor(lockIn, { name: 'Karim', profile: 'karimsnn1', platform: 'instagram-standalone' })?.handle).toBe('karimsnn1')
    // Posted to @lockinwithziad: not @danny.snoozed's box.
    expect(accountFor(lockIn, { name: 'lockinwithziad', profile: 'lockinwithziad', platform: 'tiktok-business' })).toBeNull()
  })

  it('takes a handle saved a letter or two off, and "@", case and spaces alike', () => {
    expect(accountFor([account('Instagram', 'Steven.ugcx')], { name: 'Steve', profile: 'steve.ugcx', platform: 'instagram' })?.handle).toBe('Steven.ugcx')
    expect(accountFor([account('YouTube', 'ziad.moneytalks')], { name: 'Ziad', profile: '@Ziad.Moneytalks', platform: 'youtube' })).not.toBeNull()
    expect(accountFor([account('TikTok', 'studywithmike1')], { name: 'Michael', profile: 'studywithmichael1', platform: 'tiktok' })).toBeNull()
  })

  it('takes the one account on a platform when no handle is saved to tell them apart', () => {
    expect(accountFor([account('TikTok', null)], { name: 'Ziad', profile: 'ziad.videotto', platform: 'tiktok' })).not.toBeNull()
    expect(accountFor([account('TikTok', null), account('TikTok', null)], { name: 'Ziad', profile: 'ziad.videotto', platform: 'tiktok' })).toBeNull()
  })

  it("keeps a video's own link, never the account's page", () => {
    const sent = { name: 'Karim', platform: 'instagram' }
    expect(videoLink({ links: { Karim: 'https://www.instagram.com/reel/DertGOekcEM/' } }, sent)).toBe('https://www.instagram.com/reel/DertGOekcEM/')
    expect(videoLink({ links: { lock: 'https://www.tiktok.com/@lockinwithziad' } }, { name: 'lock', platform: 'tiktok' })).toBeNull()
  })
})

describe('ticking what went out', () => {
  it("doesn't tick another account, and names the one it went to", async () => {
    const campaign = await linked(['TikTok'], 'cut-1', '@danny.snoozed')
    const result = await applyCutterPosts(adapter, [post({ accounts: [{ name: 'lockinwithziad', profile: 'lockinwithziad', platform: 'tiktok-business' }] })])
    expect(result.ticked).toBe(0)
    expect(result.unmatched).toEqual([{ campaignId: campaign.id, platform: 'tiktok-business', handle: 'lockinwithziad' }])
    expect(await adapter.listAllVideoPosts()).toHaveLength(0)
  })

  it('puts a post to two accounts in one column, even when one already has the first box ticked', async () => {
    await linked(['TikTok', 'Instagram'], 'cut-1', '@me', 2)
    const both = [
      { name: 'a', profile: 'me', platform: 'tiktok' },
      { name: 'b', profile: 'me', platform: 'instagram' },
    ]
    // First: TikTok only. Then one to both.
    await applyCutterPosts(adapter, [post({ id: 'p1', accounts: [both[0]] })])
    await applyCutterPosts(adapter, [post({ id: 'p2', accounts: both, postedAt: new Date(2026, 9, 5, 10, 0, 0).toISOString() })])
    const posts = await adapter.listAllVideoPosts()
    const second = posts.filter((p) => p.url?.startsWith('cutter:p2:'))
    expect(second).toHaveLength(2)
    expect(new Set(second.map((p) => p.video_id)).size).toBe(1)
    // Two deliverables, not three.
    expect(new Set(posts.map((p) => p.video_id)).size).toBe(2)
  })

  it('ticks a post on the day it went out, even when ticked the next morning', async () => {
    await linked(['TikTok'])
    vi.setSystemTime(new Date(2026, 9, 6, 8, 0, 0))
    await applyCutterPosts(adapter, [post({ postedAt: new Date(2026, 9, 5, 23, 31, 0).toISOString() })])
    const [tick] = await adapter.listAllVideoPosts()
    expect(new Date(tick.posted_at).toLocaleDateString('en-CA')).toBe('2026-10-05')
  })

  it('paints scheduled boxes on the accounts the posts go to', () => {
    const board = {
      campaign: { id: 'c', cutter_campaign_id: 'cut-1' },
      rows: [{ account: { id: 'tt', platform: 'TikTok', handle: 'danny.snoozed' } }, { account: { id: 'ig', platform: 'Instagram', handle: 'karimsnn1' } }],
    } as unknown as Parameters<typeof scheduledByAccount>[1][number]
    const at = new Date(2026, 9, 5, 15, 0, 0).toISOString()
    const { counts, unmatched } = scheduledByAccount(
      [
        {
          id: 's1',
          campaignId: 'cut-1',
          platforms: ['tiktok-business', 'instagram-standalone'],
          accounts: [
            { name: 'lockinwithziad', profile: 'lockinwithziad', platform: 'tiktok-business' },
            { name: 'Karim', profile: 'karimsnn1', platform: 'instagram-standalone' },
          ],
          postAt: at,
        },
      ],
      [board],
      '2026-10-05',
    )
    expect([...counts]).toEqual([['ig', 1]])
    expect(unmatched.map((u) => u.handle)).toEqual(['lockinwithziad'])
  })
})

describe('suggesting cutter links', () => {
  const planner = (id: string, name: string, extra: { cutter_campaign_id?: string | null; archived_at?: string | null } = {}) => ({
    id,
    name,
    cutter_campaign_id: extra.cutter_campaign_id ?? null,
    archived_at: extra.archived_at ?? null,
  })
  const cutter = [
    { id: 'c-inflow', name: 'Inflow' },
    { id: 'c-pump', name: 'Pump.fun' },
    { id: 'c-lock', name: 'Lock in' },
    { id: 'c-polsia', name: 'Polsia' },
    { id: 'c-polsia-r', name: 'POLSIA REACTION' },
    { id: 'c-vertus', name: 'Vertus' },
  ]

  it('matches the same name, ignoring case and punctuation, and a clear "starts with"', () => {
    const got = suggestCutterLinks([planner('p1', 'Inflow'), planner('p2', 'Pump.Fun'), planner('p3', 'Lock in App'), planner('p4', 'Polsia')], cutter)
    expect(got.map((s) => [s.campaignName, s.cutterName])).toEqual([
      ['Inflow', 'Inflow'],
      ['Pump.Fun', 'Pump.fun'],
      ['Lock in App', 'Lock in'],
      ['Polsia', 'Polsia'],
    ])
  })

  it('suggests nothing when a near match is ambiguous', () => {
    expect(suggestCutterLinks([planner('p1', 'Pol')], cutter)).toEqual([])
    expect(suggestCutterLinks([planner('p1', 'Polsia Videos')], [{ id: 'a', name: 'Polsia' }, { id: 'b', name: 'Polsia V' }])).toEqual([])
  })

  it('leaves out what is linked, archived, already taken, or dismissed', () => {
    const got = suggestCutterLinks(
      [
        planner('p1', 'Inflow', { cutter_campaign_id: 'c-inflow' }),
        planner('p2', 'Vertus', { archived_at: '2026-10-01T00:00:00Z' }),
        planner('p3', 'Inflow'),
        planner('p4', 'Pump.Fun'),
      ],
      cutter,
      new Set(['p4:c-pump']),
    )
    expect(got).toEqual([])
  })
})
