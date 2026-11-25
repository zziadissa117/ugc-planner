// One campaign field, two ids. The server keeps one row per campaign and field
// key (`unique (campaign_id, field_key)`); a device that saved the same field
// before the other device's copy came down minted its own id, and the server
// refused it - and every later save of it - with 23505, forever: 288 writes
// stuck on one device. The drain now takes the server's id and keeps the
// newer edit (NATURAL_KEYS, adoptServerRow).

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LocalAdapter } from '../data/local/LocalAdapter'
import { LocalDatabase } from '../data/local/db'
import type { CampaignField } from '../data/schema'
import { MAX_ATTEMPTS, drainOutbox, pullChanges } from './engine'
import { SupabaseSyncTarget } from './supabaseTarget'
import type { PushOutcome, SyncTarget } from './types'

const USER = '11111111-1111-4111-8111-111111111111'
const SERVER_ID = '99999999-9999-4999-8999-999999999999'

let db: LocalDatabase
let adapter: LocalAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  db = new LocalDatabase(`twin-fields-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-24T18:00:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

async function campaignWithPay(cents: string) {
  const campaign = await adapter.createCampaign({
    name: 'Vertus',
    company: null,
    default_setup: 'face',
    approval_mode: 'none',
    pay_per_video_cents: 3500,
    cycle_size: null,
  })
  // Saved three times on this device, each one queued.
  for (const value of ['3000', '3500', cents]) {
    await adapter.setCampaignField({
      campaign_id: campaign.id,
      field_key: 'pay_per_video_cents',
      field_value: value,
      source: 'user_entered',
      source_quote: null,
      source_document_id: null,
    })
  }
  return campaign
}

function serverField(campaignId: string, value: string, updatedAt: string): CampaignField {
  return {
    id: SERVER_ID,
    user_id: USER,
    campaign_id: campaignId,
    field_key: 'pay_per_video_cents',
    field_value: value,
    source: 'user_entered',
    source_quote: null,
    source_document_id: null,
    confirmed_at: null,
    updated_at: updatedAt,
  }
}

/** A server with the unique key, answering as SupabaseSyncTarget does: a
 *  row whose key is taken under another id comes back as a conflict carrying
 *  the server's row. */
function serverWith(existing: CampaignField) {
  const fields = new Map<string, Record<string, unknown>>([[existing.id, { ...existing }]])
  const pushed: string[] = []
  const target: SyncTarget = {
    name: 'fake',
    isReady: () => true,
    push: async (write): Promise<PushOutcome> => {
      if (write.table_name !== 'campaign_fields') return { status: 'applied' }
      pushed.push(write.row_id)
      const row = write.payload as Record<string, unknown>
      const twin = [...fields.values()].find(
        (f) => f.campaign_id === row.campaign_id && f.field_key === row.field_key && f.id !== row.id,
      )
      if (twin) return { status: 'conflict', remote: twin }
      fields.set(row.id as string, { ...row })
      return { status: 'applied' }
    },
    pull: async () => ({ changes: [...fields.values()].map((row) => ({ table: 'campaign_fields' as const, row })), serverTime: '2026-11-24T20:00:00.000Z' }),
  }
  return { target, fields, pushed }
}

async function makeStuck() {
  await db._outbox.toCollection().modify((entry) => {
    entry.attempts = MAX_ATTEMPTS
    entry.last_error = 'rejected: 23505: duplicate key value violates unique constraint "campaign_fields_campaign_id_field_key_key"'
  })
}

const queuedFields = async () => db._outbox.where('table_name').equals('campaign_fields').toArray()

describe('a campaign field saved under two ids', () => {
  it("keeps the server's row when it is newer, and answers every stuck write at once", async () => {
    const campaign = await campaignWithPay('4000')
    const localId = (await adapter.listCampaignFields(campaign.id))[0].id
    await makeStuck()
    expect(await queuedFields()).toHaveLength(3)

    const server = serverWith(serverField(campaign.id, '5000', '2026-11-24T19:00:00.000000+00:00'))
    expect(await adapter.retryStuckWrites()).toBeGreaterThan(0)
    const report = await drainOutbox(adapter, server.target)

    // One request settles it; the other two writes for the old id are not sent.
    expect(server.pushed).toEqual([localId])
    expect(report.conflicts).toBe(1)
    expect(await queuedFields()).toHaveLength(0)

    const [field] = await adapter.listCampaignFields(campaign.id)
    expect(field.id).toBe(SERVER_ID)
    expect(field.field_value).toBe('5000')
    expect(await db.campaign_fields.get(localId)).toBeUndefined()

    // The pull no longer trips over the key.
    const pulled = await pullChanges(adapter, server.target, null)
    expect(pulled.notes).toEqual([])
  })

  it("sends this device's edit up under the server's id when it is newer", async () => {
    const campaign = await campaignWithPay('4000')
    const localId = (await adapter.listCampaignFields(campaign.id))[0].id
    await makeStuck()

    const server = serverWith(serverField(campaign.id, '5000', '2026-11-24T10:00:00.000000+00:00'))
    await adapter.retryStuckWrites()
    await drainOutbox(adapter, server.target)

    const [field] = await adapter.listCampaignFields(campaign.id)
    expect(field.id).toBe(SERVER_ID)
    expect(field.field_value).toBe('4000')
    const queued = await queuedFields()
    expect(queued.map((e) => [e.row_id, e.op])).toEqual([[SERVER_ID, 'update']])

    // Next pass: it lands, on the server's row, and nothing is left.
    await drainOutbox(adapter, server.target)
    expect(server.fields.get(SERVER_ID)?.field_value).toBe('4000')
    expect(server.fields.has(localId)).toBe(false)
    expect(await queuedFields()).toHaveLength(0)
  })

  it('leaves a field with only one id alone', async () => {
    const campaign = await campaignWithPay('4000')
    const localId = (await adapter.listCampaignFields(campaign.id))[0].id
    const server = serverWith(serverField('another-campaign', '5000', '2026-11-24T19:00:00.000000+00:00'))
    const report = await drainOutbox(adapter, server.target)

    expect(report.conflicts).toBe(0)
    expect(server.fields.get(localId)?.field_value).toBe('4000')
    expect(await queuedFields()).toHaveLength(0)
  })
})

describe('SupabaseSyncTarget on a taken key', () => {
  /** Just enough of supabase-js for one upsert and its follow-up reads. */
  function client(twin: Record<string, unknown> | null) {
    const reads: string[][] = []
    return {
      reads,
      from: () => ({
        upsert: async () => ({ error: { code: '23505', message: 'duplicate key value violates unique constraint "campaign_fields_campaign_id_field_key_key"' } }),
        select: () => {
          const filters: string[] = []
          const query = {
            eq: (column: string) => {
              filters.push(column)
              return query
            },
            maybeSingle: async () => {
              reads.push([...filters])
              // By id: not there. By campaign and key: the twin.
              return { data: filters.includes('id') ? null : twin, error: null }
            },
          }
          return query
        },
      }),
    }
  }

  const write = {
    id: 1,
    table_name: 'campaign_fields' as const,
    row_id: 'local-id',
    op: 'insert' as const,
    payload: { id: 'local-id', campaign_id: 'c1', field_key: 'notes', field_value: 'x', updated_at: '2026-11-24T18:00:00Z' },
    queued_at: '2026-11-24T18:00:00Z',
    attempts: 0,
    last_error: null,
  }

  it("answers with the server's row under the same campaign and key", async () => {
    const twin = { id: SERVER_ID, campaign_id: 'c1', field_key: 'notes' }
    const fake = client(twin)
    const target = new SupabaseSyncTarget(fake as never)
    expect(await target.push(write)).toEqual({ status: 'conflict', remote: twin })
    expect(fake.reads).toEqual([['id'], ['campaign_id', 'field_key']])
  })

  it('still refuses it when there is no such row', async () => {
    const target = new SupabaseSyncTarget(client(null) as never)
    const outcome = await target.push(write)
    expect(outcome.status).toBe('rejected')
  })
})
