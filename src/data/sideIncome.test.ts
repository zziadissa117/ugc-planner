import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import { sideIncomeUsdCents, toUsdCents } from '../money'
import { LocalAdapter } from './local/LocalAdapter'
import { LocalDatabase } from './local/db'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: LocalAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`side-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})

describe('side income', () => {
  it("keeps each amount for its day, and lists a day's on their own", async () => {
    await adapter.addSideIncome({ source: 'detailing', amount_cents: 18000, currency: 'CAD', earned_on: '2026-11-02' })
    await adapter.addSideIncome({ source: 'media_maxing', amount_cents: 5000, currency: 'USD', earned_on: '2026-11-02' })
    await adapter.addSideIncome({ source: 'detailing', amount_cents: 9000, currency: 'CAD', earned_on: '2026-11-01' })

    const today = await adapter.listSideIncome({ on: '2026-11-02' })
    expect(today.map((e) => [e.source, e.amount_cents, e.currency])).toEqual([
      ['detailing', 18000, 'CAD'],
      ['media_maxing', 5000, 'USD'],
    ])
    expect(await adapter.listSideIncome()).toHaveLength(3)
  })

  it('queues every add and delete for the server, like every other write', async () => {
    const entry = await adapter.addSideIncome({ source: 'detailing', amount_cents: 18000, currency: 'CAD', earned_on: '2026-11-02' })
    await adapter.deleteSideIncome(entry.id)
    const writes = (await adapter.listPendingWrites()).filter((w) => w.table_name === 'side_income')
    expect(writes.map((w) => w.op)).toEqual(['insert', 'delete'])
    expect(await adapter.listSideIncome()).toHaveLength(0)
  })

  it('refuses nothing, or less, as an amount', async () => {
    await expect(
      adapter.addSideIncome({ source: 'detailing', amount_cents: 0, currency: 'CAD', earned_on: '2026-11-02' }),
    ).rejects.toThrow()
  })

  it('goes into a backup and comes back out of it', async () => {
    await adapter.addSideIncome({ source: 'media_maxing', amount_cents: 5000, currency: 'USD', earned_on: '2026-11-02' })
    const backup = await adapter.exportAll()
    expect(backup.side_income).toHaveLength(1)
  })
})

describe('adding it into Made today', () => {
  it('counts USD as it is and converts CAD at the fixed rate', () => {
    expect(toUsdCents(13700)).toBe(10000)
    expect(
      sideIncomeUsdCents([
        { amount_cents: 13700, currency: 'CAD' },
        { amount_cents: 5000, currency: 'USD' },
      ]),
    ).toBe(15000)
  })
})
