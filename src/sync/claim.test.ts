// Claiming local rows for a real account.
//
// Tested the same way the schema is: against the real thing, with only the
// unavailable part stood in for. A real LocalAdapter, real rows, real
// transactions, a real outbox - and a fake that answers "who is signed in?",
// because that is the only piece Supabase would supply.

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { ensureSeeded } from '../data/seed'
import { claimLocalRows, type AuthLike } from './claim'
import { drainOutbox } from './engine'
import type { PushOutcome, SyncTarget } from './types'

const LOCAL_ID = '00000000-0000-4000-8000-0000000000aa'
const ACCOUNT_ID = '99999999-9999-4999-8999-999999999999'

let adapter: LocalAdapter

const auth = (userId: string | null): AuthLike => ({
  getAuthState: async () => ({ userId }),
})

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`claim-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, LOCAL_ID)
  await db.open()
})

/** A campaign, a video moved through two phases, and settings - so every shape
 *  the claim has to handle is present: plain rows, append-only history, and the
 *  one table keyed by the id being changed. */
async function makeLocalData() {
  await ensureSeeded(adapter)
  const campaign = await adapter.createCampaign({
    name: 'Local',
    company: null,
    default_setup: 'face',
    approval_mode: 'none',
    pay_per_video_cents: 3500,
    cycle_size: null,
  })
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
  await adapter.updateUserSettings({ setup_switch_minutes: 12 })
  return { campaign, video }
}

async function everyRow() {
  const snapshot = await adapter.exportAll()
  return Object.entries(snapshot)
    .filter(([, value]) => Array.isArray(value))
    .flatMap(([table, rows]) =>
      (rows as { user_id: string }[]).map((row) => ({ table, user_id: row.user_id })),
    )
}

describe('claiming on first sign-in', () => {
  it('does nothing while signed out', async () => {
    await makeLocalData()
    const outcome = await claimLocalRows(adapter, auth(null))

    expect(outcome.status).toBe('signed-out')
    // Not an error. Local-first means this is the app's ordinary state.
    expect(adapter.currentUserId()).toBe(LOCAL_ID)
  })

  it('reassigns every row to the account, across every table', async () => {
    await makeLocalData()
    const before = await everyRow()
    expect(before.length).toBeGreaterThan(10)
    expect(before.every((r) => r.user_id === LOCAL_ID)).toBe(true)

    const outcome = await claimLocalRows(adapter, auth(ACCOUNT_ID))
    expect(outcome.status).toBe('claimed')

    const after = await everyRow()
    expect(after).toHaveLength(before.length)
    // Not one left behind. A single stray row is a row RLS refuses forever.
    expect(after.every((r) => r.user_id === ACCOUNT_ID)).toBe(true)
  })

  it('moves user_settings, which is keyed by the id being changed', async () => {
    await makeLocalData()
    await claimLocalRows(adapter, auth(ACCOUNT_ID))

    const settings = await adapter.getUserSettings()
    expect(settings.user_id).toBe(ACCOUNT_ID)
    expect(settings.setup_switch_minutes).toBe(12)

    // The old key is gone rather than left behind as a second orphaned row.
    const snapshot = await adapter.exportAll()
    expect(snapshot.user_settings).toHaveLength(1)
  })

  it('keeps history intact rather than rewriting it', async () => {
    const { video } = await makeLocalData()
    const before = await adapter.listPhaseEvents({ videoId: video.id })

    await claimLocalRows(adapter, auth(ACCOUNT_ID))
    const after = await adapter.listPhaseEvents({ videoId: video.id })

    expect(after).toHaveLength(before.length)
    // Same events, same order, same idempotency keys. Only the owner changed.
    expect(after.map((e) => e.client_id)).toEqual(before.map((e) => e.client_id))
    expect(after.map((e) => e.to_phase)).toEqual(before.map((e) => e.to_phase))
    expect(after.every((e) => e.user_id === ACCOUNT_ID)).toBe(true)
  })

  it('rewrites writes already queued under the local id', async () => {
    await makeLocalData()
    expect((await adapter.listPendingWrites()).length).toBeGreaterThan(0)

    const outcome = await claimLocalRows(adapter, auth(ACCOUNT_ID))
    expect(outcome.status).toBe('claimed')

    // Every payload the server will ever see names the account. One left under
    // the old id would be refused by RLS on arrival.
    const queued = await adapter.listPendingWrites()
    const owners = new Set(
      queued.map((w) => (w.payload as { user_id?: string }).user_id).filter(Boolean),
    )
    expect([...owners]).toEqual([ACCOUNT_ID])
  })

  it('leaves nothing the server would refuse, end to end', async () => {
    await makeLocalData()
    await claimLocalRows(adapter, auth(ACCOUNT_ID))

    // A server that refuses anything not owned by the signed-in account, which
    // is what RLS does.
    const refused: string[] = []
    const target: SyncTarget = {
      name: 'RLS',
      isReady: () => true,
      push: async (write): Promise<PushOutcome> => {
        const owner = (write.payload as { user_id?: string }).user_id
        if (owner !== ACCOUNT_ID) {
          refused.push(`${write.table_name}:${owner}`)
          return { status: 'rejected', reason: '42501: row level security' }
        }
        return { status: 'applied' }
      },
      pull: async () => ({ changes: [], serverTime: '2026-09-05T00:00:00.000Z' }),
    }

    const report = await drainOutbox(adapter, target, { batchSize: 1000 })

    // This is the failure the claim exists to prevent, and it is silent: a
    // refused push looks from the outside like a successful one with nothing
    // to send.
    expect(refused).toEqual([])
    expect(report.rejected).toBe(0)
    expect(await adapter.listPendingWrites()).toEqual([])
  })

  it('is a no-op the second time', async () => {
    await makeLocalData()
    await claimLocalRows(adapter, auth(ACCOUNT_ID))
    const rowsAfterFirst = await everyRow()

    const second = await claimLocalRows(adapter, auth(ACCOUNT_ID))

    expect(second.status).toBe('already-claimed')
    if (second.status === 'already-claimed') {
      expect(second.result.rowsClaimed).toBe(0)
    }
    expect(await everyRow()).toEqual(rowsAfterFirst)
  })

  it('refuses an account id that is not a uuid', async () => {
    await makeLocalData()
    // Every user_id column is a uuid. Rows written with anything else would be
    // discovered only at the first push, by which point they are the only copy.
    await expect(claimLocalRows(adapter, auth('not-a-uuid'))).rejects.toThrow(/non-uuid/)
    expect(adapter.currentUserId()).toBe(LOCAL_ID)
  })

  it('reports what it did', async () => {
    await makeLocalData()
    const outcome = await claimLocalRows(adapter, auth(ACCOUNT_ID))

    expect(outcome.status).toBe('claimed')
    if (outcome.status !== 'claimed') return
    expect(outcome.result.previousUserId).toBe(LOCAL_ID)
    expect(outcome.result.rowsClaimed).toBeGreaterThan(10)
    expect(outcome.result.pendingWritesRewritten).toBeGreaterThan(0)
  })
})
