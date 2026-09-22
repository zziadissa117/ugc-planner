// The slot model, at the data layer.
//
// The invariant worth stating plainly: a slot is one deliverable. Every
// platform ticked for slot 1 records against the SAME video, so the number of
// platforms can never change how many deliverables exist, how many are owed,
// or what the day is worth. Every bug this replaces - three Inflows, "19 of
// 6", $105 a day, $455 a day - was a version of that going wrong.

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import { localToday } from './index'
import { LocalAdapter } from './local/LocalAdapter'
import { LocalDatabase } from './local/db'
import {
  boardsForToday,
  buildBoard,
  earnedOn,
  markPosted,
  nextUnfilledCell,
  pickVideoForSlot,
  tallyBoards,
  unmarkPosted,
} from './posting'
import type { Campaign, CampaignAccount, Video } from './schema'
import { deliverablesPostedOn, ensureTodaysQuota, summariseToday } from './today'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: LocalAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`posting-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})

async function setUp(quota: number, platforms: string[]) {
  const campaign = await adapter.createCampaign({
    name: 'Inflow',
    company: null,
    default_setup: 'face',
    approval_mode: 'none',
    daily_post_quota: quota,
    pay_per_video_cents: 3500,
    cycle_size: null,
  })
  const accounts: CampaignAccount[] = []
  for (const platform of platforms) {
    accounts.push(
      // Ready: the board is only ever drawn for accounts he can actually post
      // from, so an account left at the default 'new' would give it no rows.
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

async function state(campaign: Campaign) {
  const videos = await adapter.listVideos({ campaignId: campaign.id })
  const posts = (await Promise.all(videos.map((v) => adapter.listVideoPosts(v.id)))).flat()
  const accounts = await adapter.listCampaignAccounts(campaign.id)
  return { videos, posts, accounts, board: buildBoard(campaign, accounts, videos, posts) }
}

describe('the board', () => {
  it('is one row per platform and one column per deliverable owed', async () => {
    const { campaign } = await setUp(1, ['Instagram', 'TikTok', 'YouTube'])
    const { board } = await state(campaign)

    expect(board.rows).toHaveLength(3)
    expect(board.slots).toBe(1)
    expect(board.rows.every((row) => row.cells.length === 1)).toBe(true)
    expect(board.doneToday).toBe(0)
  })

  it('leaves out an account that is still warming up', async () => {
    // "If a campaign is not set to ready then dont put it in the post tab."
    // Offering a box for an account he must not post brand content from yet is
    // offering him a mistake; the home screen is where those accounts live.
    const { campaign, accounts } = await setUp(1, ['Instagram', 'TikTok'])
    await adapter.updateCampaignAccount(accounts[1].id, { status: 'warming' })

    const { board } = await state(campaign)
    expect(board.rows).toHaveLength(1)
    expect(board.rows[0].account.platform).toBe('Instagram')
  })

  it('has no rows at all while every account is still warming up', async () => {
    const { campaign, accounts } = await setUp(1, ['Instagram'])
    await adapter.updateCampaignAccount(accounts[0].id, { status: 'new' })

    const { board } = await state(campaign)
    expect(board.rows).toHaveLength(0)
  })

  it('gives a four-a-day campaign four columns on its one platform', async () => {
    const { campaign } = await setUp(4, ['Instagram'])
    const { board } = await state(campaign)

    expect(board.rows).toHaveLength(1)
    expect(board.slots).toBe(4)
  })
})

describe('ticking a platform', () => {
  it('records three platforms against one deliverable, not three', async () => {
    const { campaign, accounts } = await setUp(1, ['Instagram', 'TikTok', 'YouTube'])

    for (const account of accounts) {
      const { board, videos } = await state(campaign)
      await markPosted(adapter, board, account, 0, videos)
    }

    const { videos, posts } = await state(campaign)
    expect(videos.filter((v) => v.phase === 'posted')).toHaveLength(1)
    expect(posts).toHaveLength(3)
    expect(deliverablesPostedOn(posts).size).toBe(1)
  })

  it('locks the rate in the first time it goes out anywhere', async () => {
    const { campaign, accounts } = await setUp(1, ['Instagram', 'TikTok'])
    const first = await state(campaign)
    await markPosted(adapter, first.board, accounts[0], 0, first.videos)

    const { videos } = await state(campaign)
    const posted = videos.find((v) => v.phase === 'posted')
    // Posted somewhere is posted: waiting for every platform meant a video
    // that went out on two of three was worth nothing at all.
    expect(posted?.rate_snapshot_cents).toBe(3500)
  })

  it('works with nothing filmed, and creates the deliverable it needs', async () => {
    const { campaign, accounts } = await setUp(1, ['Instagram'])
    expect((await state(campaign)).videos).toHaveLength(0)

    const before = await state(campaign)
    await markPosted(adapter, before.board, accounts[0], 0, before.videos)

    const { videos } = await state(campaign)
    expect(videos).toHaveLength(1)
    expect(videos[0].phase).toBe('posted')
    expect(videos[0].owed_for_date).toBe(localToday())
  })

  it('drains finished stock before inventing a row', async () => {
    const { campaign, accounts } = await setUp(1, ['Instagram'])
    const edited = await adapter.createVideo({
      campaign_id: campaign.id,
      setup: 'face',
      angle_id: null,
      script: null,
      blocked_reason: null,
      owed_for_date: null,
      rate_snapshot_cents: null,
      posted_at: null,
    })
    await adapter.advanceVideoPhase(edited.id, { session: 'film' })
    await adapter.advanceVideoPhase(edited.id, { session: 'edit' })

    const before = await state(campaign)
    await markPosted(adapter, before.board, accounts[0], 0, before.videos)

    const { videos } = await state(campaign)
    expect(videos).toHaveLength(1)
    expect(videos[0].id).toBe(edited.id)
  })

  it('fills four slots with four separate deliverables', async () => {
    const { campaign, accounts } = await setUp(4, ['Instagram'])

    for (let slot = 0; slot < 4; slot++) {
      const { board, videos } = await state(campaign)
      await markPosted(adapter, board, accounts[0], slot, videos)
    }

    const { videos, board } = await state(campaign)
    expect(videos.filter((v) => v.phase === 'posted')).toHaveLength(4)
    expect(board.doneToday).toBe(4)
    expect(new Set(board.videoIdBySlot).size).toBe(4)
  })

  it('shows an extra column when he posts more than he owes', async () => {
    const { campaign, accounts } = await setUp(1, ['Instagram'])

    const first = await state(campaign)
    await markPosted(adapter, first.board, accounts[0], 0, first.videos)
    const second = await state(campaign)
    await markPosted(adapter, second.board, accounts[0], 1, second.videos)

    const { board } = await state(campaign)
    expect(board.quota).toBe(1)
    expect(board.slots).toBe(2)
    expect(board.doneToday).toBe(2)
  })
})

describe('unticking', () => {
  it('keeps the deliverable posted while it is still out somewhere', async () => {
    const { campaign, accounts } = await setUp(1, ['Instagram', 'TikTok'])
    for (const account of accounts) {
      const { board, videos } = await state(campaign)
      await markPosted(adapter, board, account, 0, videos)
    }

    const loaded = await state(campaign)
    const tiktokPost = loaded.posts.find((p) => p.account_id === accounts[1].id)!
    await unmarkPosted(adapter, accounts[1], tiktokPost)

    const { videos } = await state(campaign)
    expect(videos.filter((v) => v.phase === 'posted')).toHaveLength(1)
  })

  it('un-earns it when the last destination goes', async () => {
    const { campaign, accounts } = await setUp(1, ['Instagram'])
    const before = await state(campaign)
    await markPosted(adapter, before.board, accounts[0], 0, before.videos)

    const loaded = await state(campaign)
    await unmarkPosted(adapter, accounts[0], loaded.posts[0])

    const { videos, board } = await state(campaign)
    expect(videos.filter((v) => v.phase === 'posted')).toHaveLength(0)
    expect(videos[0].rate_snapshot_cents).toBeNull()
    expect(board.doneToday).toBe(0)
  })
})

describe('which video a new slot reaches for', () => {
  function video(id: string, phase: Video['phase'], createdAt: string): Video {
    return {
      id,
      user_id: USER,
      campaign_id: 'c1',
      kind: 'contracted',
      setup: 'face',
      angle_id: null,
      phase,
      script: null,
      blocked_reason: null,
      owed_for_date: null,
      rate_snapshot_cents: null,
      posted_at: null,
      created_at: createdAt,
      updated_at: createdAt,
    }
  }

  it('prefers finished stock, then filmed, then unfilmed, oldest first', () => {
    const videos = [
      video('to-film-old', 'to_film', '2026-09-01T00:00:00.000Z'),
      video('filmed', 'filmed', '2026-09-03T00:00:00.000Z'),
      video('edited-new', 'edited', '2026-09-05T00:00:00.000Z'),
      video('edited-old', 'edited', '2026-09-04T00:00:00.000Z'),
    ]

    expect(pickVideoForSlot(videos, 'c1', new Set())?.id).toBe('edited-old')
    expect(pickVideoForSlot(videos, 'c1', new Set(['edited-old', 'edited-new']))?.id).toBe('filmed')
  })

  it('never reuses a deliverable already in another slot', () => {
    const videos = [video('only', 'edited', '2026-09-01T00:00:00.000Z')]
    expect(pickVideoForSlot(videos, 'c1', new Set(['only']))).toBeNull()
  })

  it('never reuses one that is already posted', () => {
    const videos = [video('done', 'posted', '2026-09-01T00:00:00.000Z')]
    expect(pickVideoForSlot(videos, 'c1', new Set())).toBeNull()
  })
})

describe('the home screen and the Post tab', () => {
  // He filled the day on the Post tab and the home screen still said "5 of 6".
  // The two screens worked today out separately: Now summed every campaign's
  // raw quota and counted every post in the store, while Post filtered the
  // boards and only counted posts on accounts it actually offered. These tests
  // exist to keep them reading one derivation.
  async function bothCounts() {
    const campaigns = await adapter.listCampaigns()
    const accounts = await adapter.listCampaignAccounts()
    const videos = await adapter.listVideos()
    const posts = (await Promise.all(videos.map((v) => adapter.listVideoPosts(v.id)))).flat()
    return {
      home: summariseToday(campaigns, accounts, videos, posts),
      tab: tallyBoards(boardsForToday(campaigns, accounts, videos, posts)),
    }
  }

  it('agree once the day is filled', async () => {
    const { campaign, accounts } = await setUp(3, ['Instagram', 'TikTok'])

    for (let slot = 0; slot < 3; slot++) {
      for (const account of accounts) {
        const { board, videos } = await state(campaign)
        await markPosted(adapter, board, account, slot, videos)
      }
    }

    const { home, tab } = await bothCounts()
    expect(home.posted).toBe(3)
    expect(home.owed).toBe(3)
    expect(tab).toEqual({ posted: home.posted, owed: home.owed })
  })

  it('do not owe a day he has no way to fill', async () => {
    // Every account still warming up: the campaign is off the Post tab, so it
    // must be off the count too. Owing a number with no box behind it is the
    // one thing this app must never do.
    const { campaign, accounts } = await setUp(4, ['Instagram'])
    await adapter.updateCampaignAccount(accounts[0].id, { status: 'warming' })

    const { home, tab } = await bothCounts()
    expect(home.owed).toBe(0)
    expect(tab.owed).toBe(0)
    expect(
      buildBoard(campaign, await adapter.listCampaignAccounts(), [], []).rows,
    ).toHaveLength(0)
  })

  it('still owe a campaign with no accounts at all, because that is fixable', async () => {
    await setUp(2, [])

    const { home, tab } = await bothCounts()
    expect(home.owed).toBe(2)
    expect(tab.owed).toBe(2)
  })

  it('keep a YouTube campaign off the tab until he marks it ready', async () => {
    // "Do not put youtube in the posting section if its warming or new... only
    // put it in post section when ready." YouTube skipping warm-up says nothing
    // about whether he is ready to post from the account.
    const campaign = await adapter.createCampaign({
      name: 'Vertus',
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      daily_post_quota: 2,
      pay_per_video_cents: 4000,
      cycle_size: null,
    })
    const account = await adapter.addCampaignAccount({
      campaign_id: campaign.id,
      platform: 'YouTube',
      handle: '@vertus',
    })
    expect(account.status).toBe('new')

    const off = await bothCounts()
    expect(off.home.owed).toBe(0)
    expect(off.tab.owed).toBe(0)

    // Warming is no different: it is still not an account he posts from.
    await adapter.updateCampaignAccount(account.id, { status: 'warming' })
    const stillOff = await bothCounts()
    expect(stillOff.tab.owed).toBe(0)

    // Ready, and it is owed and postable like anything else.
    await adapter.updateCampaignAccount(account.id, { status: 'ready' })
    const on = await bothCounts()
    expect(on.home.owed).toBe(2)
    expect(on.tab.owed).toBe(2)
  })
})

describe("today's takings", () => {
  // The figure pinned to the Post screen, and the thing the till sound is
  // allowed to celebrate.
  it('is nothing before anything goes out', async () => {
    const { campaign } = await setUp(2, ['Instagram'])
    const { videos, posts } = await state(campaign)
    expect(earnedOn(videos, posts)).toBe(0)
  })

  it('pays once for a deliverable however many platforms it went out on', async () => {
    // The whole reason it is built from de-duplicated video ids: ticking the
    // second and third platform adds destinations and not a penny, and the
    // sound must not fire over them.
    const { campaign, accounts } = await setUp(1, ['Instagram', 'TikTok', 'YouTube'])
    for (const account of accounts) {
      const { board, videos } = await state(campaign)
      await markPosted(adapter, board, account, 0, videos)
    }

    const { videos, posts } = await state(campaign)
    expect(earnedOn(videos, posts)).toBe(3500)
  })

  it('adds up across slots and campaigns', async () => {
    const first = await setUp(2, ['Instagram'])
    for (let slot = 0; slot < 2; slot++) {
      const { board, videos } = await state(first.campaign)
      await markPosted(adapter, board, first.accounts[0], slot, videos)
    }

    const videos = await adapter.listVideos()
    const posts = (await Promise.all(videos.map((v) => adapter.listVideoPosts(v.id)))).flat()
    expect(earnedOn(videos, posts)).toBe(7000)
  })

  it('gives back the money when he takes a post down', async () => {
    const { campaign, accounts } = await setUp(1, ['Instagram'])
    const before = await state(campaign)
    await markPosted(adapter, before.board, accounts[0], 0, before.videos)

    const loaded = await state(campaign)
    expect(earnedOn(loaded.videos, loaded.posts)).toBe(3500)

    await unmarkPosted(adapter, accounts[0], loaded.posts[0])
    const after = await state(campaign)
    expect(earnedOn(after.videos, after.posts)).toBe(0)
  })

  it('counts nothing for a deliverable posted before the campaign had a rate', async () => {
    // Unknown, not zero. It is picked up by backfillUnpricedVideos when a
    // rate first arrives, and inventing a price for it here would be worse
    // than the figure being low for an evening.
    const campaign = await adapter.createCampaign({
      name: 'Unpriced',
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      daily_post_quota: 1,
      pay_per_video_cents: null,
      cycle_size: null,
    })
    const account = await adapter.addCampaignAccount({
      campaign_id: campaign.id,
      platform: 'Instagram',
      handle: '@me',
      status: 'ready',
    })
    const { board, videos } = await state(campaign)
    await markPosted(adapter, board, account, 0, videos)

    const after = await state(campaign)
    expect(after.videos.filter((v) => v.phase === 'posted')).toHaveLength(1)
    expect(earnedOn(after.videos, after.posts)).toBe(0)
  })

  it('pays what the rate was when it went out, not what it is now', async () => {
    // The snapshot is what makes the ledger non-rewritable: a rate changed
    // next month must not repay last night.
    const { campaign, accounts } = await setUp(1, ['Instagram'])
    const before = await state(campaign)
    await markPosted(adapter, before.board, accounts[0], 0, before.videos)

    await adapter.updateCampaign(campaign.id, { pay_per_video_cents: 9900 })

    const after = await state(campaign)
    expect(earnedOn(after.videos, after.posts)).toBe(3500)
  })

  it('is only today, not the whole history', async () => {
    const { campaign, accounts } = await setUp(1, ['Instagram'])
    const before = await state(campaign)
    await markPosted(adapter, before.board, accounts[0], 0, before.videos)

    const after = await state(campaign)
    expect(earnedOn(after.videos, after.posts, '2026-01-01')).toBe(0)
  })
})

describe('a box stays where he tapped it', () => {
  // CLAUDE.md has said from the start that a box must turn green and stay in
  // place. It did not: the slot list was built from the videos that had
  // received a post today, packed in from the left, so ticking box 3 put the
  // tick in box 1 - and clicking box 1 next landed on the cell that now held
  // that post and silently took it back down. He found it through the sound:
  // "There are some cases when i click on them they dont make noise. THey are
  // the cases in the same y axis as one that was already checked off."
  //
  // The slots are now the video rows ensureTodaysQuota already raises, one per
  // unit of the quota, in the order it made them.
  it('marks the slot he clicked, not the first empty one', async () => {
    const { campaign, accounts } = await setUp(3, ['Instagram'])
    await ensureTodaysQuota(adapter)

    const before = await state(campaign)
    await markPosted(adapter, before.board, accounts[0], 2, before.videos)

    const { board } = await state(campaign)
    expect(board.rows[0].cells[0].post).toBeNull()
    expect(board.rows[0].cells[1].post).toBeNull()
    expect(board.rows[0].cells[2].post).not.toBeNull()
    expect(board.doneToday).toBe(1)
  })

  it('keeps every tick in its own box, whatever order he works in', async () => {
    const { campaign, accounts } = await setUp(3, ['Instagram', 'TikTok'])
    await ensureTodaysQuota(adapter)

    // The order that broke it: middle, then last, then first.
    for (const slot of [1, 2, 0]) {
      const { board, videos } = await state(campaign)
      await markPosted(adapter, board, accounts[0], slot, videos)
    }

    const { board } = await state(campaign)
    expect(board.rows[0].cells.map((c) => c.post !== null)).toEqual([true, true, true])
    expect(board.doneToday).toBe(3)
    // Three deliverables, not one posted three times.
    expect(new Set(board.videoIdBySlot).size).toBe(3)
  })

  it('does not move a tick when a later box is filled', async () => {
    const { campaign, accounts } = await setUp(3, ['Instagram'])
    await ensureTodaysQuota(adapter)

    const first = await state(campaign)
    await markPosted(adapter, first.board, accounts[0], 2, first.videos)
    const afterFirst = await state(campaign)
    const atSlotTwo = afterFirst.board.videoIdBySlot[2]

    const second = await state(campaign)
    await markPosted(adapter, second.board, accounts[0], 0, second.videos)

    const { board } = await state(campaign)
    // The first tick is still in box 3, on the same deliverable.
    expect(board.videoIdBySlot[2]).toBe(atSlotTwo)
    expect(board.rows[0].cells[2].post).not.toBeNull()
    expect(board.rows[0].cells[0].post).not.toBeNull()
    expect(board.rows[0].cells[1].post).toBeNull()
  })

  it('still shows an over-delivery beyond the quota', async () => {
    const { campaign, accounts } = await setUp(1, ['Instagram'])
    await ensureTodaysQuota(adapter)

    const first = await state(campaign)
    await markPosted(adapter, first.board, accounts[0], 0, first.videos)
    const second = await state(campaign)
    await markPosted(adapter, second.board, accounts[0], 1, second.videos)

    const { board } = await state(campaign)
    expect(board.quota).toBe(1)
    expect(board.slots).toBe(2)
    expect(board.doneToday).toBe(2)
  })
})

describe('lowering the posts owed per day', () => {
  // "If I used to have 2 posts per day and I change it to 1, there will still
  // be 2 boxes to check when there's only 1 box to check." ensureTodaysQuota
  // only ever adds today's rows, so the second one outlived the quota and the
  // board drew a box for every row.
  it('draws one box for one post owed, though two rows were raised earlier', async () => {
    const { campaign } = await setUp(2, ['Instagram', 'TikTok'])
    await ensureTodaysQuota(adapter)
    expect((await state(campaign)).board.slots).toBe(2)

    const lowered = await adapter.updateCampaign(campaign.id, { daily_post_quota: 1 })
    await ensureTodaysQuota(adapter)

    const { videos, accounts, posts } = await state(campaign)
    const board = buildBoard(lowered, accounts, videos, posts)
    expect(board.slots).toBe(1)
    expect(board.quota).toBe(1)
    expect(board.rows.every((row) => row.cells.length === 1)).toBe(true)
    // The row is still in the store: nothing was deleted to make this true.
    expect(videos.filter((v) => v.owed_for_date !== null)).toHaveLength(2)
  })

  it('brings the second box back when the quota goes up again', async () => {
    const { campaign } = await setUp(2, ['Instagram'])
    await ensureTodaysQuota(adapter)
    await adapter.updateCampaign(campaign.id, { daily_post_quota: 1 })
    const raised = await adapter.updateCampaign(campaign.id, { daily_post_quota: 2 })

    const { videos, accounts, posts } = await state(campaign)
    expect(buildBoard(raised, accounts, videos, posts).slots).toBe(2)
  })

  it('does not owe more than the new number on the home screen either', async () => {
    const { campaign } = await setUp(2, ['Instagram'])
    await ensureTodaysQuota(adapter)
    const lowered = await adapter.updateCampaign(campaign.id, { daily_post_quota: 1 })

    const { videos, accounts, posts } = await state(campaign)
    expect(tallyBoards(boardsForToday([lowered], accounts, videos, posts)).owed).toBe(1)
  })

  it('keeps a box he already ticked, even when the quota no longer covers it', async () => {
    const { campaign, accounts } = await setUp(2, ['Instagram'])
    await ensureTodaysQuota(adapter)

    // He posts the SECOND box, then cuts the quota to 1.
    const first = await state(campaign)
    await markPosted(adapter, first.board, accounts[0], 1, first.videos)
    const lowered = await adapter.updateCampaign(campaign.id, { daily_post_quota: 1 })

    const { videos, accounts: accs, posts } = await state(campaign)
    const board = buildBoard(lowered, accs, videos, posts)
    // One box, and it is the ticked one - the unticked spare is what goes.
    expect(board.slots).toBe(1)
    expect(board.rows[0].cells[0].post).not.toBeNull()
    expect(board.doneToday).toBe(1)
  })

  it('keeps every ticked box and its place when the quota is cut below what he did', async () => {
    const { campaign, accounts } = await setUp(3, ['Instagram'])
    await ensureTodaysQuota(adapter)
    for (const slot of [0, 2]) {
      const { board, videos } = await state(campaign)
      await markPosted(adapter, board, accounts[0], slot, videos)
    }
    const lowered = await adapter.updateCampaign(campaign.id, { daily_post_quota: 1 })

    const { videos, accounts: accs, posts } = await state(campaign)
    const board = buildBoard(lowered, accs, videos, posts)
    // Both posted boxes stay; the unposted middle one goes.
    expect(board.rows[0].cells.map((c) => c.post !== null)).toEqual([true, true])
    expect(board.doneToday).toBe(2)
  })
})

describe('the neural view\'s next box', () => {
  it('fills the first row\'s open slots in order', async () => {
    const { campaign, accounts } = await setUp(2, ['Instagram', 'TikTok'])
    await ensureTodaysQuota(adapter)
    const { board } = await state(campaign)

    expect(nextUnfilledCell(board)).toEqual({ account: accounts[0], slot: 0 })
  })

  it('moves to the next slot once the first is posted, staying on the same account', async () => {
    const { campaign, accounts } = await setUp(2, ['Instagram'])
    await ensureTodaysQuota(adapter)
    const first = await state(campaign)
    await markPosted(adapter, first.board, accounts[0], 0, first.videos)

    const { board } = await state(campaign)
    expect(nextUnfilledCell(board)).toEqual({ account: accounts[0], slot: 1 })
  })

  it('offers one more, past the quota, once every owed slot is posted', async () => {
    const { campaign, accounts } = await setUp(1, ['Instagram'])
    await ensureTodaysQuota(adapter)
    const first = await state(campaign)
    await markPosted(adapter, first.board, accounts[0], 0, first.videos)

    const { board } = await state(campaign)
    expect(board.slots).toBe(1)
    expect(nextUnfilledCell(board)).toEqual({ account: accounts[0], slot: 1 })
  })

  it('is null for a campaign with no account he can post from', async () => {
    const { campaign } = await setUp(1, [])
    const { board } = await state(campaign)
    expect(nextUnfilledCell(board)).toBeNull()
  })
})
