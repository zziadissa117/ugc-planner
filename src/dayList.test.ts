import { describe, expect, it } from 'vitest'

import {
  DAY_LIST_KEY,
  EMPTY_DAY,
  addLine,
  forToday,
  loadDayList,
  move,
  orderedSteps,
  replaceWith,
  tick,
  tickStep,
  view,
  type DayList,
} from './dayList'
import { newPriority } from './priorities'

const MON = new Date('2026-10-12T09:00:00')
const TUE = new Date('2026-10-13T09:00:00')
let n = 0
const id = () => `i${++n}`

const sorted = {
  items: [
    { text: 'Apply for campaigns on every app', why: 'New campaigns = money', repeat: 'daily' as const, steps: ['SideShift', 'Gimi', 'Reddit'], deadline: null },
    { text: 'Warm up Vaza accounts', why: 'Posting Vaza tomorrow', repeat: 'once' as const, steps: [], deadline: 'for tomorrow' },
    { text: 'Clean my room', why: 'Upkeep', repeat: 'once' as const, steps: [], deadline: null },
  ],
  skipped: ['My planner and cutter work perfectly'],
}

const fresh = (): DayList => replaceWith(EMPTY_DAY, sorted, 'claude-sonnet-5-5', MON, id)

describe('a sorted dictation', () => {
  it('becomes the list in the order given, with steps, repeats and the model that sorted it', () => {
    const list = fresh()
    expect(list.items.map((i) => i.text)).toEqual(['Apply for campaigns on every app', 'Warm up Vaza accounts', 'Clean my room'])
    expect(list.items[0].steps.map((s) => s.text)).toEqual(['SideShift', 'Gimi', 'Reddit'])
    expect(list.items[1].deadline).toBe('for tomorrow')
    expect(list.model).toBe('claude-sonnet-5-5')
    expect(list.skipped).toEqual(['My planner and cutter work perfectly'])
  })

  it('a new one replaces the open items and keeps the one-offs he finished', () => {
    const list = fresh()
    const withDone = tick(list, list.items[2].id, true, MON)
    const next = replaceWith(withDone, { items: [{ text: 'Buy a light', why: '', repeat: 'once', steps: [], deadline: null }], skipped: [] }, 'm', MON, id)
    expect(next.items.map((i) => [i.text, i.done])).toEqual([
      ['Buy a light', false],
      ['Clean my room', true],
    ])
  })
})

describe('ticking', () => {
  it('ticks an item done once every step is, and unticks it with a step', () => {
    let list = fresh()
    const apply = list.items[0].id
    list = tickStep(list, apply, 0, true, MON)
    list = tickStep(list, apply, 1, true, MON)
    expect(list.items[0].done).toBe(false)
    list = tickStep(list, apply, 2, true, MON)
    expect(list.items[0].done).toBe(true)
    list = tickStep(list, apply, 1, false, MON)
    expect(list.items[0].done).toBe(false)
  })

  it('every-day items start the next day unticked; one-offs stay done', () => {
    let list = fresh()
    list = tick(list, list.items[0].id, true, MON)
    list = tick(list, list.items[1].id, true, MON)
    const tuesday = forToday(list, TUE)
    expect(tuesday.items[0].done).toBe(false)
    expect(tuesday.items[0].steps.every((s) => !s.done)).toBe(true)
    expect(tuesday.items[1].done).toBe(true)
  })

  it('drops a ticked item below the open ones, keeping both in order, and puts it back when unticked', () => {
    let list = fresh()
    list = tick(list, list.items[1].id, true, MON)
    const monday = view(list, MON)
    expect(monday.open.map((i) => i.text)).toEqual(['Apply for campaigns on every app', 'Clean my room'])
    expect(monday.done.map((i) => i.text)).toEqual(['Warm up Vaza accounts'])
    expect(monday).toMatchObject({ doneCount: 1, total: 3 })

    list = tick(list, list.items[2].id, true, MON)
    list = tick(list, list.items[0].id, true, MON)
    // In the list's order, not the order ticked.
    expect(view(list, MON).done.map((i) => i.text)).toEqual(['Apply for campaigns on every app', 'Warm up Vaza accounts', 'Clean my room'])

    list = tick(list, list.items[1].id, false, MON)
    expect(view(list, MON).open.map((i) => i.text)).toEqual(['Warm up Vaza accounts'])
  })

  it('moves finished one-offs under Done the next day, and brings every-day ones back to the top', () => {
    let list = fresh()
    list = tick(list, list.items[0].id, true, MON)
    list = tick(list, list.items[1].id, true, MON)
    const tuesday = view(forToday(list, TUE), TUE)
    expect(tuesday.open.map((i) => i.text)).toEqual(['Apply for campaigns on every app', 'Clean my room'])
    expect(tuesday.done).toEqual([])
    expect(tuesday.finished.map((i) => i.text)).toEqual(['Warm up Vaza accounts'])
  })

  it('lists ticked steps below the open ones, keeping where each one is stored', () => {
    let list = fresh()
    list = tickStep(list, list.items[0].id, 0, true, MON)
    expect(orderedSteps(list.items[0]).map(({ step, index }) => [step.text, index])).toEqual([
      ['Gimi', 1],
      ['Reddit', 2],
      ['SideShift', 0],
    ])
  })
})

describe('editing', () => {
  it('moves an item up or down among the open ones, and adds a hand line before the done ones', () => {
    let list = fresh()
    list = move(list, list.items[2].id, -1)
    expect(list.items.map((i) => i.text)).toEqual(['Apply for campaigns on every app', 'Clean my room', 'Warm up Vaza accounts'])
    list = addLine(list, '  Create a Coinbase account  ', 'hand')
    expect(list.items.at(-1)).toMatchObject({ id: 'hand', text: 'Create a Coinbase account', source: 'added' })
  })
})

describe('storage', () => {
  const store = (value: string | null) => ({ getItem: (key: string) => (key === DAY_LIST_KEY ? value : null) })

  it('carries the open Priorities lines over the first time', () => {
    const priorities = [newPriority('Charge the rig', MON, 'p1'), { ...newPriority('Old', MON, 'p2'), done: true }]
    const list = loadDayList(store(null), () => priorities, MON)
    expect(list.items.map((i) => [i.id, i.text])).toEqual([['p1', 'Charge the rig']])
  })

  it('reads a broken save as an empty list, never throwing', () => {
    expect(loadDayList(store('{not json'), () => [], MON)).toEqual(EMPTY_DAY)
    expect(loadDayList(null, () => [], MON)).toEqual(EMPTY_DAY)
  })
})
