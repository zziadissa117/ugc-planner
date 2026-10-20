import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataAdapter } from '.'
import { accountFor, applyCutterPosts, joinHandColumns, mergeSplitPosts, redateCorrections, platformRoot, scheduledByAccount, videoLink, type CutterPost, suggestCutterLinks } from './cutterBridge'
import { boardsForToday, markPosted, unmarkPosted } from './posting'
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
    expect(result.unmatched).toEqual([{ campaignId: campaign.id, platform: 'tiktok-business', handle: 'lockinwithziad', at: post().postedAt }])
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

const DAY = '2026-10-05'

async function boardOf(campaignId: string) {
  const [campaigns, accounts, videos, posts] = await Promise.all([
    adapter.listCampaigns(),
    adapter.listCampaignAccounts(),
    adapter.listVideos(),
    adapter.listAllVideoPosts(),
  ])
  return { board: boardsForToday(campaigns, accounts, videos, posts, DAY).find((b) => b.campaign.id === campaignId)!, videos }
}

/** Ticks one column on every account, as his taps would. */
async function tickColumn(campaignId: string, slot: number, url: string | null = null, postedAt: string | null = null) {
  const { board } = await boardOf(campaignId)
  for (const row of board.rows) {
    const fresh = await boardOf(campaignId)
    const here = fresh.board.rows.find((r) => r.account.id === row.account.id)!.account
    await markPosted(adapter, fresh.board, here, slot, fresh.videos, DAY, url, postedAt)
  }
}

const three = [
  { name: 'a', profile: 'me', platform: 'tiktok' },
  { name: 'b', profile: 'me', platform: 'instagram' },
  { name: 'c', profile: 'me', platform: 'youtube' },
]

describe('one post, one column', () => {
  it('keeps a post to three accounts in one column next to boxes ticked by hand', async () => {
    const campaign = await linked(['TikTok', 'Instagram', 'YouTube'], 'cut-1', '@me', 2)
    await tickColumn(campaign.id, 0)
    await applyCutterPosts(adapter, [post({ id: 'p1', accounts: three, links: { b: 'https://www.instagram.com/reel/x/' } })])
    const posts = await adapter.listAllVideoPosts()
    const cutter = posts.filter((p) => p.url !== null)
    expect(cutter).toHaveLength(3)
    expect(new Set(cutter.map((p) => p.video_id)).size).toBe(1)
    // The hand column and the cutter's: two deliverables.
    expect(new Set(posts.map((p) => p.video_id)).size).toBe(2)
    const { board } = await boardOf(campaign.id)
    expect(board.doneToday).toBe(2)
  })

  it('puts a post spread over three columns back into one', async () => {
    const campaign = await linked(['TikTok', 'Instagram', 'YouTube'], 'cut-1', '@me', 2)
    await tickColumn(campaign.id, 0)
    const at = new Date(2026, 9, 5, 9, 0, 0).toISOString()
    // How the earlier pass left it: each account's tick on a video of its own.
    for (const [slot, account] of [[1, 'TikTok'], [2, 'Instagram'], [3, 'YouTube']] as const) {
      const { board, videos } = await boardOf(campaign.id)
      const row = board.rows.find((r) => r.account.platform === account)!
      await markPosted(adapter, board, row.account, slot, videos, DAY, `cutter:p1:${account.toLowerCase()}`, at)
    }
    expect((await boardOf(campaign.id)).board.doneToday).toBe(4)

    expect(await mergeSplitPosts(adapter)).toBe(2)
    const posts = await adapter.listAllVideoPosts()
    const cutter = posts.filter((p) => p.url !== null)
    expect(cutter).toHaveLength(3)
    expect(new Set(cutter.map((p) => p.video_id)).size).toBe(1)
    expect(cutter.every((p) => p.posted_at === at)).toBe(true)
    // The hand column is left alone, the two emptied videos go back.
    expect(posts.filter((p) => p.url === null)).toHaveLength(3)
    expect((await boardOf(campaign.id)).board.doneToday).toBe(2)
    const posted = (await adapter.listVideos()).filter((v) => v.phase === 'posted')
    expect(posted).toHaveLength(2)

    // Nothing split any more: a second pass moves nothing.
    expect(await mergeSplitPosts(adapter)).toBe(0)
  })

  it('takes the column he ticked by hand for it as he sent it, not one more', async () => {
    const campaign = await linked(['TikTok', 'Instagram', 'YouTube'], 'cut-1', '@me', 2)
    await tickColumn(campaign.id, 0) // at noon
    const at = new Date(2026, 9, 5, 15, 24, 0).toISOString()
    await applyCutterPosts(adapter, [post({ id: 'p1', accounts: three, postedAt: at, links: { b: 'https://www.instagram.com/reel/x/' } })])
    const posts = await adapter.listAllVideoPosts()
    expect(posts).toHaveLength(3)
    expect(new Set(posts.map((p) => p.video_id)).size).toBe(1)
    expect(posts.every((p) => p.url !== null && p.posted_at === at)).toBe(true)
    const { board } = await boardOf(campaign.id)
    expect(board.doneToday).toBe(1)
    // It stays in the box he ticked.
    expect(board.rows.every((r) => r.cells[0].post !== null)).toBe(true)
  })

  it("doesn't take a hand column on other accounts, or ticked after it went out", async () => {
    const campaign = await linked(['TikTok', 'Instagram', 'YouTube'], 'cut-1', '@me', 3)
    const { board } = await boardOf(campaign.id)
    for (const row of board.rows.filter((r) => r.account.platform !== 'YouTube')) {
      const fresh = await boardOf(campaign.id)
      await markPosted(adapter, fresh.board, row.account, 0, fresh.videos, DAY)
    }
    await applyCutterPosts(adapter, [post({ id: 'p1', accounts: three, postedAt: new Date(2026, 9, 5, 15, 0, 0).toISOString() })])
    await applyCutterPosts(adapter, [post({ id: 'p2', accounts: three.slice(0, 2), postedAt: new Date(2026, 9, 5, 9, 0, 0).toISOString() })])
    expect(new Set((await adapter.listAllVideoPosts()).map((p) => p.video_id)).size).toBe(3)
  })

  it('joins a hand column and the cutter column it was ticked for', async () => {
    const campaign = await linked(['TikTok', 'Instagram'], 'cut-1', '@me', 2)
    await tickColumn(campaign.id, 0) // noon, by hand
    const at = new Date(2026, 9, 5, 15, 24, 0).toISOString()
    vi.setSystemTime(new Date(2026, 9, 5, 15, 30, 0))
    await tickColumn(campaign.id, 1, 'cutter:p1:x', at) // how an earlier version left it
    expect((await boardOf(campaign.id)).board.doneToday).toBe(2)
    const handVideo = (await boardOf(campaign.id)).board.videoIdBySlot[0]

    expect(await joinHandColumns(adapter)).toBe(2)
    const posts = await adapter.listAllVideoPosts()
    expect(posts).toHaveLength(2)
    expect(posts.every((p) => p.video_id === handVideo && p.url === 'cutter:p1:x' && p.posted_at === at)).toBe(true)
    expect((await boardOf(campaign.id)).board.doneToday).toBe(1)
    expect((await adapter.listVideos()).filter((v) => v.phase === 'posted')).toHaveLength(1)
    expect(await joinHandColumns(adapter)).toBe(0)
  })

  it('moves a post ticked on the wrong day to the day it went out', async () => {
    const campaign = await linked(['TikTok'])
    // An earlier version ticked October 3rd's post on the 5th, when it saw it.
    await tickColumn(campaign.id, 0, 'cutter:p1:tiktok')
    const went = new Date(2026, 9, 3, 9, 0, 0).toISOString()
    await applyCutterPosts(adapter, [post({ id: 'p1', postedAt: went, views: { 'Me | Creator': 50 } })])
    const posts = await adapter.listAllVideoPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].posted_at).toBe(went)
    expect(posts[0].view_count).toBe(50)
    expect((await boardOf(campaign.id)).board.doneToday).toBe(0)
    // The money moves with it: off the 5th, onto the 3rd - never a minus today.
    const events = await adapter.listEarningsEvents()
    const on = (date: string) => events.filter((e) => e.earned_on === date).reduce((sum, e) => sum + e.amount_cents, 0)
    expect(on(DAY)).toBe(0)
    expect(on('2026-10-03')).toBe(1600)
    // Seen again: left where it is.
    await applyCutterPosts(adapter, [post({ id: 'p1', postedAt: went })])
    expect(await adapter.listAllVideoPosts()).toHaveLength(1)
  })

  it('leaves two posts that went out at the same minute apart', async () => {
    const campaign = await linked(['TikTok', 'Instagram'], 'cut-1', '@me', 2)
    const at = new Date(2026, 9, 5, 13, 31, 0).toISOString()
    for (const [slot, id] of [[0, 'p1'], [1, 'p2']] as const) {
      for (const platform of ['TikTok', 'Instagram']) {
        const { board, videos } = await boardOf(campaign.id)
        const row = board.rows.find((r) => r.account.platform === platform)!
        await markPosted(adapter, board, row.account, slot, videos, DAY, `cutter:${id}:${platform.toLowerCase()}`, at)
      }
    }
    expect(await mergeSplitPosts(adapter)).toBe(0)
    expect((await boardOf(campaign.id)).board.doneToday).toBe(2)
  })

  it('never joins boxes ticked by hand, even at the same moment', async () => {
    const campaign = await linked(['TikTok', 'Instagram'], 'cut-1', '@me', 2)
    await tickColumn(campaign.id, 0)
    await tickColumn(campaign.id, 1)
    expect(await mergeSplitPosts(adapter)).toBe(0)
    expect(new Set((await adapter.listAllVideoPosts()).map((p) => p.video_id)).size).toBe(2)
  })
})

describe('money the old corrections took off the wrong day', () => {
  async function tickedThenTakenBackOn(when: Date) {
    const campaign = await linked(['TikTok'])
    await tickColumn(campaign.id, 0)
    vi.setSystemTime(when)
    const [post] = await adapter.listAllVideoPosts()
    const [account] = await adapter.listCampaignAccounts(campaign.id)
    await unmarkPosted(adapter, account, post)
  }
  const day = async (date: string) =>
    (await adapter.listEarningsEvents()).filter((e) => e.earned_on === date).reduce((sum, e) => sum + e.amount_cents, 0)

  it('goes back to the day it was counted on, for those taken off on October 19th', async () => {
    await tickedThenTakenBackOn(new Date(Date.UTC(2026, 9, 19, 22, 35)))
    expect(await day('2026-10-19')).toBe(-1600)
    expect(await redateCorrections(adapter)).toBe(1)
    expect(await day('2026-10-19')).toBe(0)
    expect(await day(DAY)).toBe(0)
    expect(await redateCorrections(adapter)).toBe(0)
  })

  it("leaves a box he unticked himself on another day alone", async () => {
    await tickedThenTakenBackOn(new Date(Date.UTC(2026, 9, 25, 12, 0)))
    expect(await redateCorrections(adapter)).toBe(0)
    expect(await day('2026-10-25')).toBe(-1600)
  })
})

describe('views from the cutter', () => {
  it('puts each account\'s views on its tick, and keeps them up to date', async () => {
    await linked(['TikTok'])
    await applyCutterPosts(adapter, [post({ views: { 'Me | Creator': 700 } })])
    expect((await adapter.listAllVideoPosts())[0].view_count).toBe(700)
    // Read again later: the same tick, its new number.
    await applyCutterPosts(adapter, [post({ views: { 'Me | Creator': 2400 } })])
    const posts = await adapter.listAllVideoPosts()
    expect(posts).toHaveLength(1)
    expect(posts[0].view_count).toBe(2400)
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
