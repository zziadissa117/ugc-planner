// Priorities: the Setup screen's list of the small things that are not a
// campaign deliverable, sorted so the important ones get done first.
//
// It replaced a flat checklist, where the newest or easiest line got done and
// the one that moved a campaign forward sat at the bottom. What it is built
// on, and why each part is here:
//
//   - Importance is asked on its own, and before urgency. People pick an
//     urgent task over a more important one even when the important one pays
//     more ("the mere urgency effect", Zhu, Yang & Hsee 2018), and the pull
//     weakens when the payoff is put in front of them at the moment of choice.
//     So the first question is "does it move a campaign or money forward?",
//     and "does it have to happen soon?" comes second.
//   - The two answers place it like an Eisenhower matrix: important and soon
//     (do first), important not soon (plan it), soon not important (batch
//     the quick ones in one sitting), neither (drop it).
//   - Today is a short ranked list, worked one at a time from the top, with
//     anything unfinished staying on it for tomorrow (the Ivy Lee method).
//     Three, not six: he works in an evening window after a day job.
//   - An important-not-urgent item gets a "when" - a day, a time, a place.
//     A concrete when-and-where plan makes doing a thing markedly more likely
//     (Gollwitzer & Sheeran's meta-analysis of implementation intentions), and
//     writing a plan stops an unfinished task nagging at you meanwhile
//     (Masicampo & Baumeister 2011).
//
// Kept on this device only, like the checklist before it: it is a scratchpad,
// never mixed into campaign obligations or the synced production record.
// Pure, so the rules can be tested; the screen is src/screens/Priorities.tsx.

export const PRIORITIES_KEY = 'ugc-planner.priorities'
/** Where the flat checklist kept its lines; read once to carry them over. */
export const OLD_TODO_KEY = 'ugc-planner.studio-todos'
/** How many things can be on Today at once. */
export const TODAY_LIMIT = 3

export interface Priority {
  id: string
  text: string
  done: boolean
  createdAt: string
  doneAt?: string
  /** Moves a campaign or money forward. Null until he answers. */
  important: boolean | null
  /** Has to happen in the next day or two. Null until he answers. */
  urgent: boolean | null
  /** Its place on Today, from 1 (do this now); null when it is not on Today. */
  rank: number | null
  /** When and where he will do it, in his words. */
  when?: string
}

export type Group = 'today' | 'unsorted' | 'doFirst' | 'plan' | 'batch' | 'drop' | 'done'

export function newPriority(text: string, now = new Date(), id: string = crypto.randomUUID()): Priority {
  return { id, text: text.trim(), done: false, createdAt: now.toISOString(), important: null, urgent: null, rank: null }
}

export function groupOf(p: Priority): Group {
  if (p.done) return 'done'
  if (p.rank !== null) return 'today'
  if (p.important === null || p.urgent === null) return 'unsorted'
  if (p.important) return p.urgent ? 'doFirst' : 'plan'
  return p.urgent ? 'batch' : 'drop'
}

export interface Arranged {
  today: Priority[]
  unsorted: Priority[]
  doFirst: Priority[]
  plan: Priority[]
  batch: Priority[]
  drop: Priority[]
  done: Priority[]
}

/** Every item in its group: Today by rank, the rest oldest first (done ones
 *  newest first). */
export function arrange(list: readonly Priority[]): Arranged {
  const out: Arranged = { today: [], unsorted: [], doFirst: [], plan: [], batch: [], drop: [], done: [] }
  for (const p of list) out[groupOf(p)].push(p)
  out.today.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
  for (const key of ['unsorted', 'doFirst', 'plan', 'batch', 'drop'] as const) {
    out[key].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
  out.done.sort((a, b) => (b.doneAt ?? b.createdAt).localeCompare(a.doneAt ?? a.createdAt))
  return out
}

/** Today's ranks as 1..n with no gaps, in their current order. */
function compact(list: Priority[]): Priority[] {
  const order = list
    .filter((p) => p.rank !== null)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    .map((p) => p.id)
  return list.map((p) => (p.rank === null ? p : { ...p, rank: order.indexOf(p.id) + 1 }))
}

const update = (list: readonly Priority[], id: string, change: (p: Priority) => Priority): Priority[] =>
  list.map((p) => (p.id === id ? change(p) : p))

export function add(list: readonly Priority[], text: string, now = new Date()): Priority[] {
  if (text.trim() === '') return [...list]
  return [...list, newPriority(text, now)]
}

export function answer(list: readonly Priority[], id: string, question: 'important' | 'urgent', yes: boolean): Priority[] {
  return update(list, id, (p) => ({ ...p, [question]: yes }))
}

/** Back to "sort this": both answers cleared, off Today. */
export function resort(list: readonly Priority[], id: string): Priority[] {
  return compact(update(list, id, (p) => ({ ...p, important: null, urgent: null, rank: null })))
}

export function todayIsFull(list: readonly Priority[]): boolean {
  return list.filter((p) => !p.done && p.rank !== null).length >= TODAY_LIMIT
}

/** Onto the bottom of Today - if there is room, and it has been sorted. */
export function putOnToday(list: readonly Priority[], id: string): Priority[] {
  const item = list.find((p) => p.id === id)
  if (!item || item.done || item.rank !== null || groupOf(item) === 'unsorted' || todayIsFull(list)) return [...list]
  const last = Math.max(0, ...list.filter((p) => p.rank !== null).map((p) => p.rank ?? 0))
  return compact(update(list, id, (p) => ({ ...p, rank: last + 1 })))
}

export function takeOffToday(list: readonly Priority[], id: string): Priority[] {
  return compact(update(list, id, (p) => ({ ...p, rank: null })))
}

/** One place up Today; the top one stays where it is. */
export function moveUp(list: readonly Priority[], id: string): Priority[] {
  const item = list.find((p) => p.id === id)
  if (!item || item.rank === null || item.rank <= 1) return [...list]
  const above = list.find((p) => p.rank === (item.rank ?? 0) - 1)
  return list.map((p) =>
    p.id === id ? { ...p, rank: (item.rank ?? 0) - 1 } : above && p.id === above.id ? { ...p, rank: item.rank } : p,
  )
}

/** Done comes off Today, so the next one up becomes "do this now". Undone
 *  goes back to its group, not back onto Today. */
export function setDone(list: readonly Priority[], id: string, done: boolean, now = new Date()): Priority[] {
  return compact(
    update(list, id, (p) =>
      done ? { ...p, done: true, doneAt: now.toISOString(), rank: null } : { ...p, done: false, doneAt: undefined },
    ),
  )
}

export function setWhen(list: readonly Priority[], id: string, when: string): Priority[] {
  const trimmed = when.trim()
  return update(list, id, (p) => (trimmed === '' ? { ...p, when: undefined } : { ...p, when: trimmed }))
}

export function remove(list: readonly Priority[], id: string): Priority[] {
  return compact(list.filter((p) => p.id !== id))
}

export function clearDone(list: readonly Priority[]): Priority[] {
  return list.filter((p) => !p.done)
}

const isBoolOrNull = (v: unknown) => v === null || typeof v === 'boolean'

/** What was stored, keeping only well-formed items. */
export function parseStored(raw: unknown): Priority[] {
  if (!Array.isArray(raw)) return []
  const items = raw.filter(
    (p): p is Priority =>
      typeof p === 'object' &&
      p !== null &&
      typeof p.id === 'string' &&
      typeof p.text === 'string' &&
      typeof p.done === 'boolean' &&
      typeof p.createdAt === 'string' &&
      isBoolOrNull(p.important) &&
      isBoolOrNull(p.urgent) &&
      (p.rank === null || typeof p.rank === 'number'),
  )
  return compact(items.map((p) => (p.done ? { ...p, rank: null } : p)))
}

/** The flat checklist's lines, carried over unsorted so he answers the two
 *  questions for each. Done ones stay done. */
export function fromOldTodos(raw: unknown, now = new Date()): Priority[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (t): t is { id: string; text: string; done: boolean } =>
        typeof t === 'object' && t !== null && typeof t.id === 'string' && typeof t.text === 'string' && typeof t.done === 'boolean',
    )
    .map((t) => ({
      ...newPriority(t.text, now, t.id),
      done: t.done,
      ...(t.done ? { doneAt: now.toISOString() } : {}),
    }))
}

/** The saved list; on first open, the old checklist carried over. Never
 *  throws: blocked storage reads as an empty list. */
export function loadPriorities(storage: Pick<Storage, 'getItem'> | null, now = new Date()): Priority[] {
  if (!storage) return []
  try {
    const saved = storage.getItem(PRIORITIES_KEY)
    if (saved !== null) return parseStored(JSON.parse(saved))
    const old = storage.getItem(OLD_TODO_KEY)
    return old === null ? [] : fromOldTodos(JSON.parse(old), now)
  } catch {
    return []
  }
}
