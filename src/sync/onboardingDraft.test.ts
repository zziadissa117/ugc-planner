import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LocalAdapter } from '../data/local/LocalAdapter'
import { LocalDatabase } from '../data/local/db'
import {
  applyDraft,
  carriedDraft,
  forgetDraft,
  keepDraft,
  markDraftSaved,
  parseDraft,
  readDraft,
  waitingDraft,
  type OnboardingDraft,
} from './onboardingDraft'

const sendQuizFinished = vi.fn()
vi.mock('./quizFinished', () => ({ sendQuizFinished: (a: unknown) => sendQuizFinished(a) }))

const USER = '11111111-1111-4111-8111-111111111111'
const DRAFT: OnboardingDraft = {
  blocks: [
    { kind: 'record', weekday: 6, start_minute: 1080, duration_minutes: 120 },
    { kind: 'record', weekday: 1, start_minute: 1080, duration_minutes: 120 },
    { kind: 'record', weekday: 3, start_minute: 1080, duration_minutes: 120 },
    { kind: 'ideate', weekday: 4, start_minute: 600, duration_minutes: 60 },
  ],
  student_name: 'Sam',
  timezone: 'America/Toronto',
  goal: 'First campaign',
  wish: null,
  minutes_per_day: 120,
}

let adapter: LocalAdapter
beforeEach(async () => {
  indexedDB = new IDBFactory()
  localStorage.clear()
  sendQuizFinished.mockReset()
  const db = new LocalDatabase(`draft-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})

describe('a quiz finished before the account exists', () => {
  it('waits in this browser until it is saved', () => {
    expect(readDraft()).toBeNull()
    keepDraft(DRAFT)
    expect(readDraft()).toEqual(DRAFT)
    forgetDraft()
    expect(readDraft()).toBeNull()
  })

  it('is only ever one this app wrote', () => {
    expect(parseDraft(DRAFT)).toEqual(DRAFT)
    expect(parseDraft(null)).toBeNull()
    expect(parseDraft({ ...DRAFT, blocks: [] })).toBeNull()
    expect(parseDraft({ ...DRAFT, blocks: [{ ...DRAFT.blocks[0], kind: 'party' }] })).toBeNull()
    expect(parseDraft({ ...DRAFT, blocks: [{ ...DRAFT.blocks[0], weekday: 9 }] })).toBeNull()
    expect(parseDraft({ ...DRAFT, minutes_per_day: '120' })).toBeNull()
  })

  it("comes from the account's metadata when the link opened in another browser - once", () => {
    expect(waitingDraft(USER, DRAFT)).toEqual(DRAFT)
    markDraftSaved(USER)
    expect(carriedDraft(USER, DRAFT)).toBeNull()
    expect(waitingDraft(USER, DRAFT)).toBeNull()
    // This browser's own draft still wins.
    keepDraft({ ...DRAFT, goal: 'Newer' })
    expect(waitingDraft(USER, DRAFT)?.goal).toBe('Newer')
  })

  it('is saved as the week and the answers, every row queued, and tells the owner the first time only', async () => {
    await adapter.replacePlanBlocks([{ kind: 'record', weekday: 2, start_minute: 600, duration_minutes: 60 }])
    await applyDraft(adapter, DRAFT)
    const blocks = await adapter.listPlanBlocks()
    // It replaces the week that was there rather than landing beside it.
    const days = (list: readonly { kind: string; weekday: number }[]) => list.map((b) => `${b.kind} ${b.weekday}`).sort()
    expect(days(blocks)).toEqual(days(DRAFT.blocks))
    const settings = await adapter.getUserSettings()
    expect([settings.student_name, settings.goal, settings.minutes_per_day]).toEqual(['Sam', 'First campaign', 120])
    expect(settings.onboarded_at).not.toBeNull()
    expect(sendQuizFinished).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sam', week: expect.arrayContaining([expect.stringMatching(/^Sunday 6:00 pm/)]) }))
    const queued = (await adapter.listPendingWrites()).map((w) => w.table_name)
    expect(queued).toContain('user_settings')
    expect(queued.filter((t) => t === 'plan_blocks').length).toBeGreaterThanOrEqual(4)

    sendQuizFinished.mockReset()
    await applyDraft(adapter, DRAFT)
    expect(sendQuizFinished).not.toHaveBeenCalled()
  })
})
