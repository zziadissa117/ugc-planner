// The day's to-do list on the home screen: his dictation, sorted by the model
// (supabase/functions/sort-day) into one list, most important first, which he
// ticks down.
//
// Kept on this device only, like the Priorities list it replaces: it is his
// scratchpad, never mixed into campaign obligations or the synced record.
//
// - Everything is ranked, top to bottom, with no daily cap - he asked for the
//   whole list in order rather than three at a time.
// - "Every day" items (apply on every app, warm up the accounts) start the
//   day unticked again: their ticks belong to the date they were made on.
// - A one-off stays ticked, and drops into "Done" below the list.
// - Pasting a new dictation replaces the open items; the done ones stay as
//   the record of what got done.
//
// Pure, so the rules are tested (dayList.test.ts); the screen part is
// src/components/TodayList.tsx.

import type { Priority } from './priorities'

export const DAY_LIST_KEY = 'ugc-planner.day-list'

export interface DayStep {
  text: string
  done: boolean
}

export interface DayItem {
  id: string
  text: string
  /** Why it sits where it does - from the model; absent on lines he added. */
  why?: string
  repeat: 'daily' | 'once'
  deadline?: string
  steps: DayStep[]
  done: boolean
  doneAt?: string
  /** Sorted from his dictation by the model, or added by hand. */
  source: 'sorted' | 'added'
  /** For an every-day item: the date its ticks were made on. */
  tickedOn?: string
}

export interface DayList {
  /** In order: the first open one is "do this now". */
  items: DayItem[]
  /** The model that sorted the last dictation, as it reported itself. */
  model: string | null
  sortedAt: string | null
  /** What he said that needed nothing doing. */
  skipped: string[]
}

export interface SortedInput {
  items: { text: string; why: string; repeat: 'daily' | 'once'; steps: string[]; deadline: string | null }[]
  skipped: string[]
}

export const EMPTY_DAY: DayList = { items: [], model: null, sortedAt: null, skipped: [] }

/** "2026-10-11" on this device. */
export function dayOf(now: Date): string {
  return now.toLocaleDateString('en-CA')
}

const update = (list: DayList, id: string, change: (item: DayItem) => DayItem): DayList => ({
  ...list,
  items: list.items.map((item) => (item.id === id ? change(item) : item)),
})

/** A new day: every-day items start unticked again. */
export function forToday(list: DayList, now = new Date()): DayList {
  const today = dayOf(now)
  if (!list.items.some((i) => i.repeat === 'daily' && i.tickedOn !== undefined && i.tickedOn !== today)) return list
  return {
    ...list,
    items: list.items.map((item) =>
      item.repeat === 'daily' && item.tickedOn !== undefined && item.tickedOn !== today
        ? { ...item, done: false, doneAt: undefined, tickedOn: undefined, steps: item.steps.map((s) => ({ ...s, done: false })) }
        : item,
    ),
  }
}

/** The list a dictation sorts into. The open items are replaced; one-offs he
 *  already finished stay below as done. */
export function replaceWith(list: DayList, sorted: SortedInput, model: string, now = new Date(), id: () => string = () => crypto.randomUUID()): DayList {
  const kept = list.items.filter((item) => item.repeat === 'once' && item.done)
  const fresh: DayItem[] = sorted.items.map((item) => ({
    id: id(),
    text: item.text,
    why: item.why || undefined,
    repeat: item.repeat,
    ...(item.deadline ? { deadline: item.deadline } : {}),
    steps: item.steps.map((text) => ({ text, done: false })),
    done: false,
    source: 'sorted',
  }))
  return { items: [...fresh, ...kept], model, sortedAt: now.toISOString(), skipped: sorted.skipped }
}

/** Ticks or unticks a whole item, and its steps with it. */
export function tick(list: DayList, id: string, done: boolean, now = new Date()): DayList {
  return update(list, id, (item) => ({
    ...item,
    done,
    doneAt: done ? now.toISOString() : undefined,
    steps: item.steps.map((s) => ({ ...s, done })),
    ...(item.repeat === 'daily' ? { tickedOn: done ? dayOf(now) : undefined } : {}),
  }))
}

/** Ticks one step. The item is done once every step is; unticking a step
 *  makes it not done again. */
export function tickStep(list: DayList, id: string, step: number, done: boolean, now = new Date()): DayList {
  return update(list, id, (item) => {
    const steps = item.steps.map((s, i) => (i === step ? { ...s, done } : s))
    const all = steps.length > 0 && steps.every((s) => s.done)
    return {
      ...item,
      steps,
      done: all,
      doneAt: all ? (item.doneAt ?? now.toISOString()) : undefined,
      ...(item.repeat === 'daily' ? { tickedOn: steps.some((s) => s.done) ? dayOf(now) : undefined } : {}),
    }
  })
}

export function addLine(list: DayList, text: string, id: string = crypto.randomUUID()): DayList {
  const clean = text.trim()
  if (!clean) return list
  const open = list.items.filter((i) => !(i.repeat === 'once' && i.done))
  const done = list.items.filter((i) => i.repeat === 'once' && i.done)
  return { ...list, items: [...open, { id, text: clean, repeat: 'once', steps: [], done: false, source: 'added' }, ...done] }
}

export function remove(list: DayList, id: string): DayList {
  return { ...list, items: list.items.filter((i) => i.id !== id) }
}

export function editText(list: DayList, id: string, text: string): DayList {
  const clean = text.trim()
  return clean ? update(list, id, (item) => ({ ...item, text: clean })) : list
}

/** One place up (-1) or down (+1) among the items not done yet - the ones
 *  he sees in order at the top. */
export function move(list: DayList, id: string, by: -1 | 1): DayList {
  const open = list.items.map((item, index) => ({ item, index })).filter(({ item }) => !item.done)
  const at = open.findIndex(({ item }) => item.id === id)
  const to = at + by
  if (at < 0 || to < 0 || to >= open.length) return list
  const items = [...list.items]
  const [a, b] = [open[at].index, open[to].index]
  ;[items[a], items[b]] = [items[b], items[a]]
  return { ...list, items }
}

export interface DayView {
  /** Not done yet, in the list's order: the first is "do this now". */
  open: DayItem[]
  /** Ticked today, below the open ones - in the list's order, not the order
   *  ticked, so the bottom stays organised and an untick puts one back where
   *  it was. */
  done: DayItem[]
  /** How many of today's are ticked, and of how many. */
  doneCount: number
  total: number
  /** One-offs finished on an earlier day, newest first. */
  finished: DayItem[]
}

/** What the home screen shows. A ticked item drops below the open ones - he
 *  asked for it, so the top of the list is only what is left to do. The list
 *  itself never reorders: only the view splits it. */
export function view(list: DayList, now = new Date()): DayView {
  const today = dayOf(now)
  const earlier = (i: DayItem) => i.repeat === 'once' && i.done && i.doneAt !== undefined && dayOf(new Date(i.doneAt)) !== today
  const current = list.items.filter((i) => !earlier(i))
  const finished = list.items.filter(earlier).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''))
  const done = current.filter((i) => i.done)
  return { open: current.filter((i) => !i.done), done, doneCount: done.length, total: current.length, finished }
}

/** An item's steps for the screen: not done first, then done, each in their
 *  own order, with the stored index kept for ticking. */
export function orderedSteps(item: DayItem): { step: DayStep; index: number }[] {
  const all = item.steps.map((step, index) => ({ step, index }))
  return [...all.filter((s) => !s.step.done), ...all.filter((s) => s.step.done)]
}

/** The open lines of the old Priorities list, carried over once at the
 *  bottom so nothing he wrote there is lost. */
export function fromPriorities(priorities: readonly Priority[]): DayItem[] {
  return priorities
    .filter((p) => !p.done && p.text.trim())
    .map((p) => ({ id: p.id, text: p.text.trim(), repeat: 'once' as const, steps: [], done: false, source: 'added' as const }))
}

function parse(raw: unknown): DayList | null {
  if (!raw || typeof raw !== 'object') return null
  const body = raw as Record<string, unknown>
  if (!Array.isArray(body.items)) return null
  const items = body.items.filter(
    (i): i is DayItem =>
      typeof i === 'object' &&
      i !== null &&
      typeof (i as DayItem).id === 'string' &&
      typeof (i as DayItem).text === 'string' &&
      typeof (i as DayItem).done === 'boolean' &&
      ((i as DayItem).repeat === 'daily' || (i as DayItem).repeat === 'once') &&
      Array.isArray((i as DayItem).steps),
  )
  return {
    items: items.map((i) => ({ ...i, steps: i.steps.filter((s) => s && typeof s.text === 'string').map((s) => ({ text: s.text, done: s.done === true })) })),
    model: typeof body.model === 'string' ? body.model : null,
    sortedAt: typeof body.sortedAt === 'string' ? body.sortedAt : null,
    skipped: Array.isArray(body.skipped) ? body.skipped.filter((s): s is string => typeof s === 'string') : [],
  }
}

/** The saved list - or, the first time, the old Priorities carried over.
 *  Never throws: blocked or broken storage reads as an empty list. */
export function loadDayList(storage: Pick<Storage, 'getItem'> | null, priorities: () => Priority[], now = new Date()): DayList {
  if (!storage) return EMPTY_DAY
  try {
    const saved = storage.getItem(DAY_LIST_KEY)
    if (saved !== null) return forToday(parse(JSON.parse(saved)) ?? EMPTY_DAY, now)
    return { ...EMPTY_DAY, items: fromPriorities(priorities()) }
  } catch {
    return EMPTY_DAY
  }
}

export function saveDayList(storage: Pick<Storage, 'setItem'> | null, list: DayList): void {
  try {
    storage?.setItem(DAY_LIST_KEY, JSON.stringify(list))
  } catch {
    // Full or blocked storage: the list still works for this visit.
  }
}
