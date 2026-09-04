// The sync layer, tested against a fake server.
//
// None of this needs a Supabase project: the outbox, the drain and the
// conflict rules are all decisions the client makes, and a double that answers
// applied / conflict / rejected / unavailable exercises every one of them.

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataAdapter, PendingWrite } from '../data'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { resolveConflict } from './conflict'
import { drainOutbox, pullChanges } from './engine'
import type { PushOutcome, SyncTarget } from './types'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: DataAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`sync-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})

/** A server that answers however the test says. */
function fakeTarget(
  answer: (write: PendingWrite) => PushOutcome | Promise<PushOutcome>,
  overrides: Partial<SyncTarget> = {},
): SyncTarget {
  return {
    name: 'Fake',
    isReady: () => true,
    push: vi.fn(async (write) => answer(write)),
    pull: vi.fn(async () => ({ changes: [], serverTime: '2026-09-04T00:00:00.000Z' })),
    ...overrides,
  }
}

async function makeCampaign(name = 'Test') {
  return adapter.createCampaign({
    name,
    company: null,
    default_setup: 'face',
    approval_mode: 'none',
    pay_per_video_cents: 3500,
    cycle_size: null,
  })
}

describe('the outbox', () => {
  it('queues every write, oldest first', async () => {
    await makeCampaign('A')
    await makeCampaign('B')

    const pending = await adapter.listPendingWrites()
    expect(pending).toHaveLength(2)
    expect(pending[0].table_name).toBe('campaigns')
    expect((pending[0].payload as { name: string }).name).toBe('A')
    expect(pending[0].id).toBeLessThan(pending[1].id)
  })

  it('queues the video and its history together when a phase moves', async () => {
    const campaign = await makeCampaign()
    const video = await adapter.createVideo({
      campaign_id: campaign.id,
      setup: 'face',
      angle_id: null,
      script: null,
      blocked_reason: null,
      owed_for_date: null,
      rate_snapshot_cents: null,
      posted_at: null,
    })
    await adapter.advanceVideoPhase(video.id, { session: 'film' })

    const tables = (await adapter.listPendingWrites()).map((w) => w.table_name)
    expect(tables).toEqual(['campaigns', 'videos', 'videos'])
  })
})

describe('draining', () => {
  it('sends everything the server accepts and empties the queue', async () => {
    await makeCampaign()
    const report = await drainOutbox(adapter, fakeTarget(() => ({ status: 'applied' })))

    expect(report.applied).toBe(1)
    expect(await adapter.listPendingWrites()).toEqual([])
  })

  it('sends nothing when the target is not ready', async () => {
    await makeCampaign()
    const target = fakeTarget(() => ({ status: 'applied' }), { isReady: () => false })

    const report = await drainOutbox(adapter, target)
    expect(report.applied).toBe(0)
    expect(target.push).not.toHaveBeenCalled()
    // Still queued. Nothing was lost by being offline.
    expect(await adapter.listPendingWrites()).toHaveLength(1)
  })

  it('keeps a write queued when the server is unreachable', async () => {
    await makeCampaign()
    const report = await drainOutbox(
      adapter,
      fakeTarget(() => ({ status: 'unavailable', reason: 'offline' })),
    )

    expect(report.deferred).toBe(1)
    const [pending] = await adapter.listPendingWrites()
    expect(pending.attempts).toBe(1)
    expect(pending.last_error).toBe('offline')
  })

  it('stops the batch at the first outage rather than burning every attempt', async () => {
    await makeCampaign('A')
    await makeCampaign('B')
    await makeCampaign('C')

    const target = fakeTarget(() => ({ status: 'unavailable', reason: 'offline' }))
    await drainOutbox(adapter, target)

    // One attempt, not three, against the same outage.
    expect(target.push).toHaveBeenCalledTimes(1)
    const pending = await adapter.listPendingWrites()
    expect(pending.map((w) => w.attempts)).toEqual([1, 0, 0])
  })

  it('treats a throwing target as an outage, not as a bad write', async () => {
    await makeCampaign()
    const report = await drainOutbox(
      adapter,
      fakeTarget(() => {
        throw new Error('socket hang up')
      }),
    )

    expect(report.deferred).toBe(1)
    expect((await adapter.listPendingWrites())[0].last_error).toBe('socket hang up')
  })

  it('keeps a permanently rejected write instead of throwing it away', async () => {
    await makeCampaign()
    const report = await drainOutbox(
      adapter,
      fakeTarget(() => ({ status: 'rejected', reason: 'check violation' })),
    )

    expect(report.rejected).toBe(1)
    // Still a write that happened. Dropping it is how data goes missing.
    const [pending] = await adapter.listPendingWrites()
    expect(pending.last_error).toContain('check violation')
    expect(report.notes.join(' ')).toContain('check violation')
  })

  it('stops retrying a stuck write but leaves it visible', async () => {
    await makeCampaign()
    const target = fakeTarget(() => ({ status: 'unavailable', reason: 'nope' }))

    for (let i = 0; i < 6; i++) await drainOutbox(adapter, target, { maxAttempts: 3 })

    const report = await drainOutbox(adapter, target, { maxAttempts: 3 })
    expect(report.stuck).toBe(1)
    expect(await adapter.listPendingWrites()).toHaveLength(1)
  })

  it('sends in the order things happened', async () => {
    const campaign = await makeCampaign()
    await adapter.updateCampaign(campaign.id, { name: 'Renamed' })

    const seen: string[] = []
    await drainOutbox(
      adapter,
      fakeTarget((write) => {
        seen.push((write.payload as { name: string }).name)
        return { status: 'applied' }
      }),
    )

    // The create reaches the server before the rename that follows it.
    expect(seen).toEqual(['Test', 'Renamed'])
  })
})

describe('conflicts', () => {
  it('takes the server version when it is newer, and stops pushing ours', async () => {
    const campaign = await makeCampaign('Mine')
    const remote = {
      ...campaign,
      name: 'Theirs',
      updated_at: '2099-01-01T00:00:00.000Z',
    }

    const report = await drainOutbox(
      adapter,
      fakeTarget(() => ({ status: 'conflict', remote })),
    )

    expect(report.conflicts).toBe(1)
    expect((await adapter.getCampaign(campaign.id))?.name).toBe('Theirs')
    expect(await adapter.listPendingWrites()).toEqual([])
  })

  it('keeps ours queued when this device has the newer edit', async () => {
    const campaign = await makeCampaign('Mine')
    const remote = { ...campaign, name: 'Stale', updated_at: '2000-01-01T00:00:00.000Z' }

    const report = await drainOutbox(
      adapter,
      fakeTarget(() => ({ status: 'conflict', remote })),
    )

    expect(report.conflicts).toBe(1)
    expect((await adapter.getCampaign(campaign.id))?.name).toBe('Mine')
    // Left queued so the next pass pushes it again.
    expect(await adapter.listPendingWrites()).toHaveLength(1)
  })
})

describe('the conflict rules', () => {
  const video = (overrides: Record<string, unknown> = {}) => ({
    id: 'v1',
    phase: 'posted',
    rate_snapshot_cents: 3500,
    posted_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  })

  it('never rewrites history', () => {
    const resolution = resolveConflict(
      'phase_events',
      { id: 1, to_phase: 'filmed', updated_at: '2099-01-01T00:00:00.000Z' },
      { id: 1, to_phase: 'filmed' },
    )
    // Newer local timestamp does not matter. An event that exists is the same
    // event told twice.
    expect(resolution.winner).toBe('remote')
  })

  it('is last-write-wins for ordinary rows', () => {
    const older = { id: 'c1', name: 'Old', updated_at: '2026-01-01T00:00:00.000Z' }
    const newer = { id: 'c1', name: 'New', updated_at: '2026-09-01T00:00:00.000Z' }

    expect(resolveConflict('campaigns', newer, older).winner).toBe('local')
    expect(resolveConflict('campaigns', older, newer).winner).toBe('remote')
  })

  it('keeps a locked-in rate even when the other side wins the row', () => {
    const local = video({ rate_snapshot_cents: 3500 })
    const remote = video({
      rate_snapshot_cents: null,
      posted_at: null,
      phase: 'approved',
      updated_at: '2099-01-01T00:00:00.000Z',
    })

    const resolution = resolveConflict('videos', local, remote)
    expect(resolution.winner).toBe('remote')
    // A stale device must not be able to null out what a post earned.
    expect(resolution.row.rate_snapshot_cents).toBe(3500)
  })

  it('keeps the rate from whichever side posted first', () => {
    const local = video({
      rate_snapshot_cents: 3500,
      posted_at: '2026-09-01T00:00:00.000Z',
    })
    const remote = video({
      rate_snapshot_cents: 5000,
      posted_at: '2026-09-05T00:00:00.000Z',
      updated_at: '2099-01-01T00:00:00.000Z',
    })

    const resolution = resolveConflict('videos', local, remote)
    // The earlier snapshot recorded what the work actually earned. The later
    // one priced it again at a rate that had already changed.
    expect(resolution.row.rate_snapshot_cents).toBe(3500)
  })

  it('carries posted_at along with a rescued rate', () => {
    const local = video({ rate_snapshot_cents: 3500, posted_at: '2026-09-01T00:00:00.000Z' })
    const remote = video({
      rate_snapshot_cents: null,
      posted_at: null,
      updated_at: '2099-01-01T00:00:00.000Z',
    })

    const resolution = resolveConflict('videos', local, remote)
    // Otherwise the merged row breaks posted_is_timestamped.
    expect(resolution.row.posted_at).toBe('2026-09-01T00:00:00.000Z')
  })
})

describe('pulling', () => {
  it('writes server rows locally without queuing them back', async () => {
    const campaign = await makeCampaign('Mine')
    await drainOutbox(adapter, fakeTarget(() => ({ status: 'applied' })))
    expect(await adapter.listPendingWrites()).toEqual([])

    const report = await pullChanges(
      adapter,
      fakeTarget(() => ({ status: 'applied' }), {
        pull: async () => ({
          changes: [{ table: 'campaigns', row: { ...campaign, name: 'Renamed elsewhere' } }],
          serverTime: '2026-09-04T00:00:00.000Z',
        }),
      }),
      null,
    )

    expect(report.appliedRows).toBe(1)
    expect((await adapter.getCampaign(campaign.id))?.name).toBe('Renamed elsewhere')
    // Echoing it back would be a loop that never settles.
    expect(await adapter.listPendingWrites()).toEqual([])
  })

  it('skips a server row the schema would refuse, and says so', async () => {
    const report = await pullChanges(
      adapter,
      fakeTarget(() => ({ status: 'applied' }), {
        pull: async () => ({
          // A posted video with no posted_at breaks posted_is_timestamped.
          changes: [
            {
              table: 'videos',
              row: {
                id: 'v1',
                user_id: USER,
                campaign_id: 'c1',
                kind: 'contracted',
                setup: 'face',
                angle_id: null,
                phase: 'posted',
                script: null,
                blocked_reason: null,
                owed_for_date: null,
                rate_snapshot_cents: null,
                posted_at: null,
                created_at: '2026-09-01T00:00:00.000Z',
                updated_at: '2026-09-01T00:00:00.000Z',
              },
            },
          ],
          serverTime: '2026-09-04T00:00:00.000Z',
        }),
      }),
      null,
    )

    expect(report.appliedRows).toBe(0)
    expect(report.notes.join(' ')).toContain('must say when it went live')
    // Reported and skipped rather than forced in. A row the schema refuses is
    // refused whichever side of the sync it arrived from.
    expect(await adapter.listVideos()).toEqual([])
  })
})
