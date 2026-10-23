// What the bridge does with an account the cutter posts to that the campaign
// does not have: the cutter is where posts really go, so a missing platform
// is added, an empty handle is filled, a typo'd handle is put right - and
// another person's account on the same platform is left alone.

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataAdapter } from '.'
import { applyCutterPosts, pruneRoster, rosterKey, type CutterPost, type Roster } from './cutterBridge'
import { LocalDatabase } from './local/db'
import { LocalAdapter } from './local/LocalAdapter'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: DataAdapter

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 23, 12, 0, 0))
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`bridge-roster-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})
afterEach(() => vi.useRealTimers())

async function linked(accounts: { platform: string; handle: string | null }[]) {
  const campaign = await adapter.createCampaign({
    name: 'GRUBBY', company: null, default_setup: 'face', approval_mode: 'none',
    daily_post_quota: 1, pay_per_video_cents: 2000, cycle_size: null, cutter_campaign_id: 'cut-1',
  })
  for (const { platform, handle } of accounts) {
    await adapter.addCampaignAccount({ campaign_id: campaign.id, platform, handle, status: 'ready' })
  }
  return campaign
}

const post = (profile: string, platform = 'tiktok-business', id = 'p1'): CutterPost => ({
  id,
  campaignId: 'cut-1',
  campaignName: 'GRUBBY',
  accounts: [{ name: 'Study With Michael', profile, platform }],
  links: {},
  postedAt: new Date(2026, 9, 23, 9, 0, 0).toISOString(),
})

describe('an account the campaign does not have', () => {
  it('is added when the campaign has no account on that platform at all', async () => {
    const campaign = await linked([{ platform: 'TikTok', handle: 'studywithmichael1' }])
    const outcome = await applyCutterPosts(adapter, [post('jrinselikesai', 'instagram-standalone')], {}, true)
    expect(outcome.added).toMatchObject([{ platform: 'Instagram', handle: 'jrinselikesai' }])
    expect(outcome.ticked).toBe(1)
    const accounts = await adapter.listCampaignAccounts(campaign.id)
    expect(accounts.map((a) => [a.platform, a.handle, a.status])).toEqual([
      ['TikTok', 'studywithmichael1', 'ready'],
      ['Instagram', 'jrinselikesai', 'ready'],
    ])
  })

  it('fills in a handle the one account on the platform never had', async () => {
    const campaign = await linked([{ platform: 'Instagram', handle: null }])
    const outcome = await applyCutterPosts(adapter, [post('jrinselikesai', 'instagram-standalone')], {}, true)
    expect(outcome.ticked).toBe(1)
    expect(outcome.renamed).toMatchObject([{ platform: 'Instagram', handle: 'jrinselikesai', from: null }])
    expect((await adapter.listCampaignAccounts(campaign.id))[0].handle).toBe('jrinselikesai')
  })

  it("corrects a typo'd handle when the cutter only ever posts the campaign to that one account", async () => {
    const campaign = await linked([{ platform: 'TikTok', handle: 'studywithmike1' }])
    const roster: Roster = {}
    const outcome = await applyCutterPosts(adapter, [post('studywithmichael1')], roster, true)
    expect(outcome.renamed).toMatchObject([{ platform: 'TikTok', handle: 'studywithmichael1', from: 'studywithmike1' }])
    expect(outcome.ticked).toBe(1)
    expect((await adapter.listCampaignAccounts(campaign.id))[0].handle).toBe('studywithmichael1')
    expect(Object.keys(roster[rosterKey(campaign.id, 'tiktok')])).toEqual(['studywithmichael1'])
  })

  it('corrects nothing from a roster that does not cover the whole fortnight', async () => {
    const campaign = await linked([{ platform: 'TikTok', handle: 'studywithmike1' }])
    const outcome = await applyCutterPosts(adapter, [post('studywithmichael1')], {}, false)
    expect(outcome.renamed).toEqual([])
    expect(outcome.unmatched).toHaveLength(1)
    expect((await adapter.listCampaignAccounts(campaign.id))[0].handle).toBe('studywithmike1')
  })

  it("leaves another person's account alone when the cutter posts the campaign to two on the platform", async () => {
    const campaign = await linked([{ platform: 'Instagram', handle: 'hooksandmike' }])
    const roster: Roster = { [rosterKey(campaign.id, 'instagram')]: { hooksandmike: new Date(2026, 9, 20).toISOString() } }
    const outcome = await applyCutterPosts(adapter, [post('hooknjake', 'instagram-standalone')], roster, true)
    expect(outcome.renamed).toEqual([])
    expect(outcome.added).toEqual([])
    expect(outcome.unmatched).toMatchObject([{ platform: 'instagram-standalone', handle: 'hooknjake' }])
    expect(outcome.ticked).toBe(0)
    expect((await adapter.listCampaignAccounts(campaign.id))[0].handle).toBe('hooksandmike')
  })
})

describe('the roster', () => {
  it('forgets what is older than a fortnight', () => {
    const old = new Date(2026, 9, 1).toISOString()
    const recent = new Date(2026, 9, 22).toISOString()
    expect(pruneRoster({ 'c|tiktok': { a: old, b: recent }, 'c|instagram': { z: old } })).toEqual({ 'c|tiktok': { b: recent } })
  })
})
