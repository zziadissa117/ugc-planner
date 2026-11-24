// Coach notes (migration 0025): notes the coach writes to a student, written
// only by the server and brought down by the sync pull. The student's device
// reads them and never writes them - not through an intent, and not through
// any of the generic paths that sweep every mirrored table into the outbox
// (backfillOutbox, claimRowsForUser, retryStuckWrites, importAll). A queued
// write would be refused by RLS forever and sit stuck.

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import type { Transaction } from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'

import { claimLocalRows } from '../sync/claim'
import { drainOutbox, pullChanges } from '../sync/engine'
import type { PushOutcome, SyncTarget } from '../sync/types'
import { DataError, LocalAdapter } from './local/LocalAdapter'
import { LocalDatabase, PULL_ONLY_TABLES } from './local/db'
import type { CoachNote } from './schema'

const STUDENT = '11111111-1111-4111-8111-111111111111'
const COACH = '22222222-2222-4222-8222-222222222222'
const OTHER_STUDENT = '33333333-3333-4333-8333-333333333333'
// 2026-11-22 is a Sunday; the app's weeks start on Sunday.
const SUNDAY = '2026-11-22'

let db: LocalDatabase
let adapter: LocalAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  db = new LocalDatabase(`coach-notes-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, STUDENT)
  await db.open()
})

/** A coach_notes row as the server sends it: microseconds and +00:00. */
function note(overrides: Partial<CoachNote> = {}): CoachNote {
  return {
    id: crypto.randomUUID(),
    user_id: STUDENT,
    author_id: COACH,
    campaign_id: null,
    post_id: null,
    post_url: null,
    week_start: null,
    body: 'Lead with the product',
    created_at: '2026-11-24T19:00:00.000000+00:00',
    updated_at: '2026-11-24T19:00:00.000000+00:00',
    deleted_at: null,
    ...overrides,
  }
}

async function makeCampaign(name = 'Vertus') {
  return adapter.createCampaign({
    name,
    company: null,
    default_setup: 'face',
    approval_mode: 'none',
    pay_per_video_cents: 3500,
    cycle_size: null,
  })
}

const queuedCoachNotes = async () => (await db._outbox.where('table_name').equals('coach_notes').toArray()).length

/** A server that answers like RLS: coach_notes is never writable from here. */
function rlsTarget(changes: { table: 'coach_notes'; row: Record<string, unknown> }[] = []) {
  const refused: string[] = []
  const target: SyncTarget = {
    name: 'RLS',
    isReady: () => true,
    push: async (write): Promise<PushOutcome> => {
      if (write.table_name === 'coach_notes') {
        refused.push(`${write.op} ${write.row_id}`)
        return { status: 'rejected', reason: '42501: new row violates row-level security policy' }
      }
      return { status: 'applied' }
    },
    pull: async () => ({ changes, serverTime: '2026-11-24T20:00:00.000Z' }),
  }
  return { target, refused }
}

describe('listCoachNotes', () => {
  it('lists notes newest first, comparing times as instants whatever their spelling', async () => {
    const oldest = note({ body: 'Oldest', created_at: '2026-11-20T10:00:00.000000+00:00' })
    // Written as Z with milliseconds; the same instant spelled the server's
    // way would sort differently as text.
    const middle = note({ body: 'Middle', created_at: '2026-11-22T15:30:00.500Z' })
    const newest = note({ body: 'Newest', created_at: '2026-11-22T15:30:00.900000+00:00' })
    for (const row of [middle, oldest, newest]) await adapter.applyRemoteRow('coach_notes', row)

    expect((await adapter.listCoachNotes()).map((n) => n.body)).toEqual(['Newest', 'Middle', 'Oldest'])
  })

  it("filters to one campaign's notes", async () => {
    const vertus = await makeCampaign('Vertus')
    const inflow = await makeCampaign('Inflow')
    await adapter.applyRemoteRow('coach_notes', note({ body: 'About Vertus', campaign_id: vertus.id }))
    await adapter.applyRemoteRow('coach_notes', note({ body: 'About Inflow', campaign_id: inflow.id }))
    await adapter.applyRemoteRow('coach_notes', note({ body: 'About nothing in particular' }))

    expect((await adapter.listCoachNotes({ campaignId: vertus.id })).map((n) => n.body)).toEqual(['About Vertus'])
    expect(await adapter.listCoachNotes({ campaignId: crypto.randomUUID() })).toEqual([])
    expect(await adapter.listCoachNotes()).toHaveLength(3)
  })

  it('shows only notes for whoever is signed in', async () => {
    await adapter.applyRemoteRow('coach_notes', note({ body: 'For me' }))
    // A device that changed accounts can still hold a note to the previous one.
    await adapter.applyRemoteRow('coach_notes', note({ body: 'For someone else', user_id: OTHER_STUDENT }))

    expect((await adapter.listCoachNotes()).map((n) => n.body)).toEqual(['For me'])
  })

  it('stops showing a note once the coach deletes it - the deletion arrives as an edit', async () => {
    const kept = note({ body: 'Keep this' })
    const gone = note({ body: 'Never mind' })
    await adapter.applyRemoteRow('coach_notes', kept)
    await adapter.applyRemoteRow('coach_notes', gone)
    expect((await adapter.listCoachNotes()).map((n) => n.body).sort()).toEqual(['Keep this', 'Never mind'])
    await adapter.applyRemoteRow('coach_notes', { ...gone, deleted_at: '2026-11-25T10:00:00.000000+00:00', updated_at: '2026-11-25T10:00:00.000000+00:00' })
    expect((await adapter.listCoachNotes()).map((n) => n.body)).toEqual(['Keep this'])
  })

  it('is empty, not an error, when the coach has written nothing', async () => {
    expect(await adapter.listCoachNotes()).toEqual([])
  })

  it('offers no way to write a note', () => {
    // The only coach-note verb on the adapter is the read.
    const verbs = Object.getOwnPropertyNames(LocalAdapter.prototype).filter((name) => /coach/i.test(name))
    expect(verbs).toEqual(['listCoachNotes'])
  })
})

describe('the pull', () => {
  it('applies coach_notes rows like any other table, and queues nothing for them', async () => {
    const campaign = await makeCampaign()
    const pulled = note({ campaign_id: campaign.id, week_start: SUNDAY, post_id: 'post-1', post_url: 'https://www.tiktok.com/@v/video/1' })
    const { target } = rlsTarget([{ table: 'coach_notes', row: pulled as unknown as Record<string, unknown> }])

    const report = await pullChanges(adapter, target, null)

    expect(report.appliedRows).toBe(1)
    expect(await adapter.listCoachNotes()).toEqual([pulled])
    expect(await queuedCoachNotes()).toBe(0)
  })

  it('takes an edit of a note it already has, by id', async () => {
    const first = note({ body: 'First go' })
    await adapter.applyRemoteRow('coach_notes', first)
    await adapter.applyRemoteRow('coach_notes', { ...first, body: 'Edited', updated_at: '2026-11-25T08:00:00.000000+00:00' })

    const notes = await adapter.listCoachNotes()
    expect(notes).toHaveLength(1)
    expect(notes[0].body).toBe('Edited')
  })

  it('fills the columns an older server did not send', async () => {
    const { post_id: _postId, post_url: _postUrl, week_start: _week, campaign_id: _campaign, ...bare } = note()
    await adapter.applyRemoteRow('coach_notes', bare)
    const [stored] = await adapter.listCoachNotes()
    expect(stored).toMatchObject({ campaign_id: null, post_id: null, post_url: null, week_start: null })
  })

  it('skips a row the schema would refuse, and says so', async () => {
    const { target } = rlsTarget([
      { table: 'coach_notes', row: note({ week_start: '2026-11-23' }) as unknown as Record<string, unknown> },
      { table: 'coach_notes', row: note({ body: '' }) as unknown as Record<string, unknown> },
      { table: 'coach_notes', row: note({ body: 'a'.repeat(4001) }) as unknown as Record<string, unknown> },
    ])
    const report = await pullChanges(adapter, target, null)

    expect(report.appliedRows).toBe(0)
    expect(report.notes).toHaveLength(3)
    expect(report.notes.join(' ')).toContain('must be a Sunday')
    expect(await adapter.listCoachNotes()).toEqual([])
  })
})

describe('never queued for the server', () => {
  it('refuses a coach_notes write at the outbox itself, rolling the write back', async () => {
    expect(PULL_ONLY_TABLES.has('coach_notes')).toBe(true)
    const row = note()
    const enqueue = (adapter as unknown as {
      enqueue(tx: Transaction, table: 'coach_notes', id: string, op: 'insert', payload: unknown): void
    }).enqueue.bind(adapter)

    await expect(
      db.transaction('rw', [db.coach_notes, db._outbox], async (tx) => {
        await tx.table('coach_notes').add(row)
        enqueue(tx, 'coach_notes', row.id, 'insert', row)
      }),
      // Dexie rethrows the abort under the original's name, not its class.
    ).rejects.toMatchObject({ name: DataError.name, message: expect.stringMatching(/written only by the server/) })
    expect(await db.coach_notes.count()).toBe(0)
    expect(await db._outbox.count()).toBe(0)
  })

  it('is left out of backfillOutbox, which queues every other row', async () => {
    await makeCampaign()
    await adapter.applyRemoteRow('coach_notes', note())
    await db._outbox.clear()

    const queued = await adapter.backfillOutbox()

    expect(queued).toBeGreaterThan(0)
    const tables = (await adapter.listPendingWrites()).map((w) => w.table_name)
    expect(tables).toContain('campaigns')
    expect(tables).not.toContain('coach_notes')
  })

  it('is left out of the claim: never re-owned, never queued', async () => {
    const LOCAL_ID = '00000000-0000-4000-8000-0000000000aa'
    const local = new LocalAdapter(db, LOCAL_ID)
    await local.createCampaign({
      name: 'Local',
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      pay_per_video_cents: 3500,
      cycle_size: null,
    })
    // The strongest case: a note whose owner is the very id being replaced,
    // which is exactly what the claim rewrites in every other table.
    const mine = note({ user_id: LOCAL_ID })
    await local.applyRemoteRow('coach_notes', mine)

    const outcome = await claimLocalRows(local, { getAuthState: async () => ({ userId: STUDENT }) })

    expect(outcome.status).toBe('claimed')
    expect((await db.campaigns.toArray()).every((c) => c.user_id === STUDENT)).toBe(true)
    expect((await db.coach_notes.get(mine.id))?.user_id).toBe(LOCAL_ID)
    expect(await queuedCoachNotes()).toBe(0)
  })

  it('does not rewrite a stray coach_notes entry already in the outbox during the claim', async () => {
    const LOCAL_ID = '00000000-0000-4000-8000-0000000000aa'
    const local = new LocalAdapter(db, LOCAL_ID)
    const stray = note({ user_id: LOCAL_ID })
    await db._outbox.add({
      table_name: 'coach_notes', row_id: stray.id, op: 'insert', payload: stray,
      queued_at: new Date().toISOString(), attempts: 0,
    } as never)

    const outcome = await claimLocalRows(local, { getAuthState: async () => ({ userId: STUDENT }) })

    expect(outcome.status).toBe('claimed')
    if (outcome.status === 'claimed') expect(outcome.result.pendingWritesRewritten).toBe(0)
    const [entry] = await db._outbox.where('table_name').equals('coach_notes').toArray()
    expect((entry.payload as CoachNote).user_id).toBe(LOCAL_ID)
  })

  it('is not revived by retryStuckWrites', async () => {
    const campaign = await makeCampaign()
    // Every write refused once, so every entry has an attempt against it.
    await db._outbox.toCollection().modify({ attempts: 5 })
    const stray = note()
    await db._outbox.add({
      table_name: 'coach_notes', row_id: stray.id, op: 'insert', payload: stray,
      queued_at: new Date().toISOString(), attempts: 5,
    } as never)

    const revived = await adapter.retryStuckWrites()

    expect(revived).toBe(1)
    const entries = await db._outbox.toArray()
    expect(entries.find((e) => e.row_id === campaign.id)?.attempts).toBe(0)
    expect(entries.find((e) => e.table_name === 'coach_notes')?.attempts).toBe(5)
  })

  it('is neither queued nor replaced by a backup import', async () => {
    await makeCampaign()
    await adapter.applyRemoteRow('coach_notes', note({ body: 'Pulled before the restore' }))
    const snapshot = await adapter.exportAll()
    expect(snapshot.coach_notes).toHaveLength(1)

    // The backup's own notes are ignored: the server's copy is the record and
    // the device keeps what the pull brought down.
    const fromBackup = { ...snapshot, coach_notes: [note({ body: 'Only in the backup' })] }
    const result = await adapter.importAll(JSON.parse(JSON.stringify(fromBackup)))

    expect(result.counts.campaigns).toBe(1)
    expect(result.counts).not.toHaveProperty('coach_notes')
    expect((await adapter.listCoachNotes()).map((n) => n.body)).toEqual(['Pulled before the restore'])
    expect(await queuedCoachNotes()).toBe(0)

    // An older backup with no coach_notes at all leaves them too.
    const { coach_notes: _dropped, ...older } = snapshot
    await adapter.importAll(JSON.parse(JSON.stringify(older)))
    expect(await adapter.listCoachNotes()).toHaveLength(1)
    // After a restore, the sweep that runs once per device still leaves them out.
    await adapter.backfillOutbox()
    expect(await queuedCoachNotes()).toBe(0)
  })

  it('leaves nothing the server would refuse, end to end: pull, claim, backfill, retry, drain', async () => {
    const LOCAL_ID = '00000000-0000-4000-8000-0000000000aa'
    const local = new LocalAdapter(db, LOCAL_ID)
    await local.createCampaign({
      name: 'Local',
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      pay_per_video_cents: 3500,
      cycle_size: null,
    })
    await claimLocalRows(local, { getAuthState: async () => ({ userId: STUDENT }) })
    const { target, refused } = rlsTarget([{ table: 'coach_notes', row: note() as unknown as Record<string, unknown> }])

    // The order AuthProvider runs a pass in, then a second pass.
    await local.backfillOutbox()
    await local.retryStuckWrites()
    await drainOutbox(local, target, { batchSize: 1000 })
    await pullChanges(local, target, null)
    await local.backfillOutbox()
    await claimLocalRows(local, { getAuthState: async () => ({ userId: STUDENT }) })
    const report = await drainOutbox(local, target, { batchSize: 1000 })

    expect(await local.listCoachNotes()).toHaveLength(1)
    expect(refused).toEqual([])
    expect(report.rejected).toBe(0)
    expect(await local.listPendingWrites()).toEqual([])
  })
})
