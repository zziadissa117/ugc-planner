import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataAdapter } from '.'
import { applyCutterPosts, platformRoot, type CutterPost, suggestCutterLinks } from './cutterBridge'
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

async function linked(platforms: string[], cutterId: string | null = 'cut-1') {
  const campaign = await adapter.createCampaign({
    name: 'Inflow',
    company: null,
    default_setup: 'face',
    approval_mode: 'none',
    daily_post_quota: 1,
    pay_per_video_cents: 1600,
    cycle_size: null,
    cutter_campaign_id: cutterId,
  })
  for (const platform of platforms) {
    await adapter.addCampaignAccount({ campaign_id: campaign.id, platform, handle: '@me', status: 'ready' })
  }
  return campaign
}

const post = (over: Partial<CutterPost> = {}): CutterPost => ({
  id: 'p1',
  campaignId: 'cut-1',
  campaignName: 'Inflow',
  accounts: [{ name: 'me', platform: 'tiktok' }],
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
    expect(await applyCutterPosts(adapter, [post()])).toBe(1)
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
    expect(await applyCutterPosts(adapter, [post()])).toBe(0)
    expect(await adapter.listAllVideoPosts()).toHaveLength(1)
  })

  it('one post to two platforms is one deliverable with two destinations', async () => {
    const campaign = await linked(['TikTok', 'Instagram'])
    await applyCutterPosts(adapter, [
      post({ accounts: [{ name: 'a', platform: 'tiktok' }, { name: 'b', platform: 'instagram' }] }),
    ])
    const posts = await adapter.listAllVideoPosts()
    expect(posts).toHaveLength(2)
    expect(new Set(posts.map((p) => p.video_id)).size).toBe(1)
    expect((await adapter.listVideos({ campaignId: campaign.id })).filter((v) => v.phase === 'posted')).toHaveLength(1)
  })

  it('uses the platform link when the cutter has one', async () => {
    await linked(['TikTok'])
    await applyCutterPosts(adapter, [post({ links: { tiktok: 'https://tiktok.com/@me/video/1' } })])
    expect((await adapter.listAllVideoPosts())[0].url).toBe('https://tiktok.com/@me/video/1')
  })

  it('leaves unlinked campaigns and platforms with no account alone', async () => {
    await linked(['TikTok'], null)
    expect(await applyCutterPosts(adapter, [post()])).toBe(0)
    await linked(['Instagram'])
    expect(await applyCutterPosts(adapter, [post()])).toBe(0)
    expect(await adapter.listAllVideoPosts()).toHaveLength(0)
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
