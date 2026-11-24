// Trybe videos and ideate notes (migration 0024): the two tables behind the
// Today screen's Trybe timer and its ideate session.

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import { ConstraintError } from './constraints'
import { DataError, LocalAdapter } from './local/LocalAdapter'
import { LocalDatabase } from './local/db'

const USER = '11111111-1111-4111-8111-111111111111'
// 2026-11-22 is a Sunday; the app's weeks start on Sunday.
const SUNDAY = '2026-11-22'
const NEXT_SUNDAY = '2026-11-29'
let adapter: LocalAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`trybe-ideate-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})

const queued = async (table: string) =>
  (await adapter.listPendingWrites()).filter((w) => w.table_name === table)

describe('trybe videos', () => {
  it('records one row a tap, and lists a range oldest first', async () => {
    await adapter.logTrybeVideo(new Date('2026-11-24T19:30:00Z'))
    await adapter.logTrybeVideo(new Date('2026-11-24T19:05:00Z'))
    await adapter.logTrybeVideo(new Date('2026-11-23T19:00:00Z'))

    const all = await adapter.listTrybeVideos()
    expect(all.map((v) => v.made_at)).toEqual([
      '2026-11-23T19:00:00.000Z',
      '2026-11-24T19:05:00.000Z',
      '2026-11-24T19:30:00.000Z',
    ])

    // From is inclusive, to is exclusive: a day is [its midnight, the next).
    const day = await adapter.listTrybeVideos({ from: '2026-11-24T00:00:00Z', to: '2026-11-25T00:00:00Z' })
    expect(day).toHaveLength(2)
    expect(await adapter.listTrybeVideos({ from: '2026-11-24T19:05:00Z' })).toHaveLength(2)
    expect(await adapter.listTrybeVideos({ to: '2026-11-24T19:05:00Z' })).toHaveLength(1)
  })

  it('stamps now when no time is given, for the signed-in user', async () => {
    const before = Date.now()
    const row = await adapter.logTrybeVideo()
    expect(Date.parse(row.made_at)).toBeGreaterThanOrEqual(before)
    expect(row.user_id).toBe(USER)
  })

  it('queues every tap, and an undo deletes the row and queues the delete', async () => {
    const first = await adapter.logTrybeVideo()
    await adapter.logTrybeVideo()
    await adapter.undoTrybeVideo(first.id)

    expect(await adapter.listTrybeVideos()).toHaveLength(1)
    const writes = await queued('trybe_videos')
    expect(writes.map((w) => w.op)).toEqual(['insert', 'insert', 'delete'])
    expect(writes[2].row_id).toBe(first.id)
  })

  it('does nothing, and queues nothing, when the undone row is already gone', async () => {
    await adapter.undoTrybeVideo(crypto.randomUUID())
    expect(await queued('trybe_videos')).toHaveLength(0)
  })

  it('compares times as instants, whatever spelling the server sent', async () => {
    await adapter.logTrybeVideo(new Date('2026-11-24T19:00:00.500Z'))
    // A pulled row: Postgres spells timestamptz with microseconds and +00:00.
    await adapter.applyRemoteRow('trybe_videos', {
      id: crypto.randomUUID(),
      user_id: USER,
      made_at: '2026-11-24T19:00:00.123456+00:00',
      updated_at: '2026-11-24T19:00:01.000000+00:00',
    })
    const rows = await adapter.listTrybeVideos({ from: '2026-11-24T19:00:00Z', to: '2026-11-24T19:00:00.200Z' })
    expect(rows.map((r) => r.made_at)).toEqual(['2026-11-24T19:00:00.123456+00:00'])
    const all = await adapter.listTrybeVideos()
    expect(all[0].made_at).toBe('2026-11-24T19:00:00.123456+00:00')
  })

  it('goes into a backup and comes back out of it', async () => {
    await adapter.logTrybeVideo()
    const backup = await adapter.exportAll()
    expect(backup.trybe_videos).toHaveLength(1)
    await adapter.reset('everything')
    await adapter.importAll(backup)
    expect(await adapter.listTrybeVideos()).toHaveLength(1)
  })
})

async function makeCampaign(name = 'Vertus') {
  return adapter.createCampaign({
    name,
    company: null,
    default_setup: 'face',
    approval_mode: 'none',
    daily_post_quota: 0,
    pay_per_video_cents: null,
    cycle_size: null,
  })
}

describe('ideate notes', () => {
  it('saves a note about an account and one about the whole campaign, and lists by campaign and week', async () => {
    const campaign = await makeCampaign()
    const other = await makeCampaign('Inflow')
    const tiktok = await adapter.addCampaignAccount({ campaign_id: campaign.id, platform: 'TikTok', handle: '@v' })

    const about = await adapter.saveIdeateNote({
      campaign_id: campaign.id,
      account_id: tiktok.id,
      week_start: SUNDAY,
      body: 'Hook 2 held past 3s - film three more like it.',
    })
    await adapter.saveIdeateNote({ campaign_id: campaign.id, account_id: null, week_start: SUNDAY, body: 'Whole campaign' })
    await adapter.saveIdeateNote({ campaign_id: campaign.id, account_id: null, week_start: NEXT_SUNDAY, body: 'Later' })
    await adapter.saveIdeateNote({ campaign_id: other.id, account_id: null, week_start: SUNDAY, body: 'Elsewhere' })

    expect(about).toMatchObject({ user_id: USER, account_id: tiktok.id, week_start: SUNDAY })
    const week = await adapter.listIdeateNotes({ campaignId: campaign.id, weekStart: SUNDAY })
    expect(week.map((n) => n.body)).toEqual(['Hook 2 held past 3s - film three more like it.', 'Whole campaign'])
    expect((await adapter.listIdeateNotes({ campaignId: campaign.id })).map((n) => n.week_start)).toEqual([
      SUNDAY,
      SUNDAY,
      NEXT_SUNDAY,
    ])
    expect(await adapter.listIdeateNotes({ weekStart: SUNDAY })).toHaveLength(3)
    expect(await adapter.listIdeateNotes()).toHaveLength(4)
  })

  it('edits a saved note in place: same row, same created_at, queued as an update', async () => {
    const campaign = await makeCampaign()
    const saved = await adapter.saveIdeateNote({ campaign_id: campaign.id, account_id: null, week_start: SUNDAY, body: 'First go' })
    const edited = await adapter.saveIdeateNote({ ...saved, body: 'Second go' })

    expect(edited.id).toBe(saved.id)
    expect(edited.created_at).toBe(saved.created_at)
    expect(edited.body).toBe('Second go')
    expect(await adapter.listIdeateNotes()).toEqual([edited])
    const writes = await queued('ideate_notes')
    expect(writes.map((w) => [w.op, w.row_id])).toEqual([
      ['insert', saved.id],
      ['update', saved.id],
    ])
    expect((writes[1].payload as { body: string }).body).toBe('Second go')
  })

  it('takes an id that is not saved yet as a new note', async () => {
    const campaign = await makeCampaign()
    const id = crypto.randomUUID()
    const row = await adapter.saveIdeateNote({ id, campaign_id: campaign.id, account_id: null, week_start: SUNDAY, body: 'x' })
    expect(row.id).toBe(id)
    expect((await queued('ideate_notes')).map((w) => w.op)).toEqual(['insert'])
  })

  it('deletes a note and queues the delete', async () => {
    const campaign = await makeCampaign()
    const saved = await adapter.saveIdeateNote({ campaign_id: campaign.id, account_id: null, week_start: SUNDAY, body: 'Gone soon' })
    await adapter.deleteIdeateNote(saved.id)
    await adapter.deleteIdeateNote(saved.id)

    expect(await adapter.listIdeateNotes()).toHaveLength(0)
    expect((await queued('ideate_notes')).map((w) => w.op)).toEqual(['insert', 'delete'])
  })

  it('refuses an empty note, one over 4000 characters, and a week that does not start on Sunday', async () => {
    const campaign = await makeCampaign()
    const save = (week_start: string, body: string) =>
      adapter.saveIdeateNote({ campaign_id: campaign.id, account_id: null, week_start, body })

    await expect(save(SUNDAY, '')).rejects.toBeInstanceOf(ConstraintError)
    await expect(save(SUNDAY, 'a'.repeat(4001))).rejects.toBeInstanceOf(ConstraintError)
    await expect(save('2026-11-23', 'Monday')).rejects.toBeInstanceOf(ConstraintError)
    await expect(save('22/11/2026', 'Not a date')).rejects.toBeInstanceOf(ConstraintError)
    expect(await adapter.listIdeateNotes()).toHaveLength(0)
    expect(await queued('ideate_notes')).toHaveLength(0)

    // Characters, as Postgres counts them: 4000 emoji is 8000 UTF-16 units.
    await expect(save(SUNDAY, 'a'.repeat(4000))).resolves.toBeDefined()
    await expect(save(SUNDAY, '🎬'.repeat(4000))).resolves.toBeDefined()
  })

  it('refuses a campaign that does not exist, and an account of another campaign', async () => {
    const campaign = await makeCampaign()
    const other = await makeCampaign('Inflow')
    const theirs = await adapter.addCampaignAccount({ campaign_id: other.id, platform: 'TikTok', handle: '@i' })

    await expect(
      adapter.saveIdeateNote({ campaign_id: crypto.randomUUID(), account_id: null, week_start: SUNDAY, body: 'x' }),
    ).rejects.toBeInstanceOf(DataError)
    await expect(
      adapter.saveIdeateNote({ campaign_id: campaign.id, account_id: theirs.id, week_start: SUNDAY, body: 'x' }),
    ).rejects.toBeInstanceOf(DataError)
    await expect(
      adapter.saveIdeateNote({ campaign_id: campaign.id, account_id: crypto.randomUUID(), week_start: SUNDAY, body: 'x' }),
    ).rejects.toBeInstanceOf(DataError)
    expect(await queued('ideate_notes')).toHaveLength(0)
  })

  it('goes into a backup and comes back out of it', async () => {
    const campaign = await makeCampaign()
    await adapter.saveIdeateNote({ campaign_id: campaign.id, account_id: null, week_start: SUNDAY, body: 'Keep me' })
    const backup = await adapter.exportAll()
    expect(backup.ideate_notes).toHaveLength(1)
    await adapter.reset('everything')
    await adapter.importAll(backup)
    expect((await adapter.listIdeateNotes()).map((n) => n.body)).toEqual(['Keep me'])
  })
})
