import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import { LocalAdapter } from './local/LocalAdapter'
import { LocalDatabase } from './local/db'

const USER = '11111111-1111-4111-8111-111111111111'
let db: LocalDatabase
let adapter: LocalAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  db = new LocalDatabase(`plan-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})

describe('the saved week', () => {
  it("is only the latest save, even when another device's old week is still on this one", async () => {
    // This device saved a week...
    await adapter.replacePlanBlocks([{ kind: 'record', weekday: 0, start_minute: 1080, duration_minutes: 120 }])
    // ...then pulled the week he saved since on his phone. Pulls never delete,
    // so the old block stays in the store; the new ones are spelled the way
    // the server spells times.
    const later = '2099-01-01T10:00:00.123456+00:00'
    for (const [weekday, start] of [
      [2, 600],
      [4, 600],
    ]) {
      await db.plan_blocks.put({ id: crypto.randomUUID(), user_id: USER, kind: 'record', weekday, start_minute: start, duration_minutes: 60, updated_at: later })
    }
    const week = await adapter.listPlanBlocks()
    expect(week.map((b) => [b.weekday, b.start_minute])).toEqual([
      [2, 600],
      [4, 600],
    ])
  })

  it('is empty before anything is saved', async () => {
    expect(await adapter.listPlanBlocks()).toEqual([])
  })
})
