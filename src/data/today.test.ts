import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import { localToday } from './index'
import { LocalDatabase } from './local/db'
import { LocalAdapter } from './local/LocalAdapter'
import { SESSION_TARGET_PHASE } from './phases'
import { INFLOW_CAMPAIGN_ID, ensureSeeded } from './seed'
import { ensureTodaysQuota, summariseToday } from './today'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: LocalAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`today-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
  await ensureSeeded(adapter)
})

async function summary() {
  return summariseToday(await adapter.listCampaigns(), await adapter.listVideos())
}

describe("today's quota", () => {
  it('raises one video per unit of daily quota', async () => {
    const created = await ensureTodaysQuota(adapter)
    expect(created).toBe(1) // Inflow owes 1 posted video per day

    const owed = await adapter.listVideos({ owedForDate: localToday() })
    expect(owed).toHaveLength(1)
    expect(owed[0]).toMatchObject({ kind: 'contracted', phase: 'to_film', setup: 'face' })
  })

  it('is idempotent within a day', async () => {
    await ensureTodaysQuota(adapter)
    expect(await ensureTodaysQuota(adapter)).toBe(0)
    expect(await adapter.listVideos({ owedForDate: localToday() })).toHaveLength(1)
  })

  it('does not evaporate a mid-pipeline video when the date changes', async () => {
    // Yesterday's video, already filmed.
    await ensureTodaysQuota(adapter, '2026-09-03')
    const [yesterday] = await adapter.listVideos({ owedForDate: '2026-09-03' })
    await adapter.advanceVideoPhase(yesterday.id, { session: 'film' })

    await ensureTodaysQuota(adapter, '2026-09-04')

    const still = await adapter.getVideo(yesterday.id)
    // The quota resets at midnight. Work in flight does not.
    expect(still?.phase).toBe('filmed')
    expect(await adapter.listVideos({ owedForDate: '2026-09-04' })).toHaveLength(1)
  })

  it('creates nothing for a campaign with no daily quota', async () => {
    await adapter.updateCampaign(INFLOW_CAMPAIGN_ID, { daily_post_quota: 0 })
    expect(await ensureTodaysQuota(adapter)).toBe(0)
  })
})

describe('runway', () => {
  it('is zero on a fresh store', async () => {
    await ensureTodaysQuota(adapter)
    expect((await summary()).runwayDays).toBe(0)
  })

  it('rises when a video is edited and ready to go out', async () => {
    await ensureTodaysQuota(adapter)
    const [video] = await adapter.listVideos()

    for (const _ of ['filmed', 'edited']) {
      await adapter.advanceVideoPhase(video.id)
    }
    expect((await adapter.getVideo(video.id))?.phase).toBe('edited')
    expect((await summary()).runwayDays).toBe(1)
  })

  it('drops by one per post', async () => {
    await ensureTodaysQuota(adapter)
    const [video] = await adapter.listVideos()
    for (const _ of ['filmed', 'edited']) {
      await adapter.advanceVideoPhase(video.id)
    }
    expect((await summary()).runwayDays).toBe(1)

    await adapter.advanceVideoPhase(video.id) // posted
    expect((await summary()).runwayDays).toBe(0)
  })

  it('counts posts made today against the day owed', async () => {
    await ensureTodaysQuota(adapter)
    const [video] = await adapter.listVideos()
    await adapter.markVideoPosted(video.id, { session: 'post' })

    const s = await summary()
    expect(s.posted).toBe(1)
    expect(s.owed).toBe(1)
  })
})

describe('marking posted from the tick-off list', () => {
  it('goes straight to posted from wherever it is, in one event', async () => {
    await ensureTodaysQuota(adapter)
    const [video] = await adapter.listVideos()
    expect(video.phase).toBe('to_film')

    const posted = await adapter.markVideoPosted(video.id, { session: 'post' })
    expect(posted.phase).toBe('posted')
    expect(posted.rate_snapshot_cents).toBe(3500)

    const events = await adapter.listPhaseEvents({ videoId: video.id })
    // Creation, then one honest jump. No invented intermediate steps.
    expect(events.map((e) => [e.from_phase, e.to_phase])).toEqual([
      [null, 'to_film'],
      ['to_film', 'posted'],
    ])
  })

  it('undoes back to where it came from, not to the chain predecessor', async () => {
    await ensureTodaysQuota(adapter)
    const [video] = await adapter.listVideos()
    await adapter.markVideoPosted(video.id, { session: 'post' })

    const undone = await adapter.undoLastPhaseMove(video.id)
    // Not 'approved', which is what the chain says precedes posted.
    expect(undone.phase).toBe('to_film')
    expect(undone.posted_at).toBeNull()
    expect(undone.rate_snapshot_cents).toBeNull()
  })

  it('refuses to undo a video that has never moved', async () => {
    await ensureTodaysQuota(adapter)
    const [video] = await adapter.listVideos()
    await expect(adapter.undoLastPhaseMove(video.id)).rejects.toThrow()
  })
})

// The dead end that made the app feel useless: a video walked as far as
// `edited` and stopped, because POST sessions looked for `approved` - a phase
// most campaigns never had and nothing could move a video into. So POST was
// always empty, runway was always 0, and the ledger never moved.
describe('a video can actually reach the end', () => {
  it('leaves an edited video where a POST session will find it', async () => {
    await ensureTodaysQuota(adapter)
    const [video] = await adapter.listVideos()

    await adapter.advanceVideoPhase(video.id, { session: 'film' })
    await adapter.advanceVideoPhase(video.id, { session: 'edit' })

    const waiting = await adapter.listVideos({ phases: [SESSION_TARGET_PHASE.post] })
    expect(waiting.map((v) => v.id)).toContain(video.id)
  })

  it('gets from filming to posted, and pays for it', async () => {
    await ensureTodaysQuota(adapter)
    const [video] = await adapter.listVideos()

    for (const session of ['film', 'edit', 'post'] as const) {
      await adapter.advanceVideoPhase(video.id, { session })
    }

    const posted = await adapter.getVideo(video.id)
    expect(posted?.phase).toBe('posted')
    // The rate is snapshotted on posting, which is what makes Money move at
    // all - it stayed at $0.00 for as long as nothing could be posted.
    expect(posted?.rate_snapshot_cents).toBe(3500)
  })
})
