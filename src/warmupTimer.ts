// The two countdowns on TODAY - the Trybe timer and the plain one used for
// warm-ups - kept as timestamps rather than as a number that counts down.
//
// It used to be a `secondsLeft` in a component's state, ticking once a second.
// Leaving the screen unmounted the component and the count was gone, and even
// staying put, a backgrounded tab throttles its timers so the number drifted.
// A countdown is instead a start and an END TIME; what is left is always the
// end minus the clock, so it is right after a tab switch, a page change, a
// reload, or an hour away.
//
// There used to be one timer per account, carrying the account's platform and
// handle, and a session that walked a queue of accounts. That is gone: warming
// up is now a countdown he sets himself, and nothing here knows about accounts.

/** The same key the per-account timers used: what they left behind fails the
 *  check below, is dropped on the first read and overwritten on the first
 *  write, rather than sitting in storage under a key nothing reads. */
const STORAGE_KEY = 'ugc-planner.warmup_timers'

/** One of each, at most. */
export type TimerKind = 'trybe' | 'warmup'

export const TIMER_NAME: Record<TimerKind, string> = {
  trybe: 'Trybe videos',
  warmup: 'Warm-up',
}

export interface CountdownRecord {
  kind: TimerKind
  /** How long it was set for. */
  minutes: number
  startedAt: number
  endsAt: number
  /** Set once the chime has gone off, so it sounds once per countdown and a
   *  reload after it finished does not ring it again. */
  alerted: boolean
}

/** Whole seconds remaining, never negative. Rounded up, so it reads 00:01 until
 *  the very moment it hits zero instead of showing 00:00 a second early. */
export function secondsLeft(timer: CountdownRecord, now: number): number {
  return Math.max(0, Math.ceil((timer.endsAt - now) / 1000))
}

export function isFinished(timer: CountdownRecord, now: number): boolean {
  return now >= timer.endsAt
}

export function startCountdown(kind: TimerKind, minutes: number, now: number): CountdownRecord {
  return { kind, minutes, startedAt: now, endsAt: now + minutes * 60_000, alerted: false }
}

/** "04:59", "60:00" - minutes are not wrapped into hours: a one-hour Trybe
 *  timer reads 60:00 and counts down from there. */
export function formatClock(seconds: number): string {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function valid(value: unknown): value is CountdownRecord {
  const t = value as CountdownRecord
  return (
    typeof t === 'object' &&
    t !== null &&
    (t.kind === 'trybe' || t.kind === 'warmup') &&
    typeof t.minutes === 'number' &&
    t.minutes > 0 &&
    typeof t.startedAt === 'number' &&
    typeof t.endsAt === 'number' &&
    typeof t.alerted === 'boolean'
  )
}

export function readTimers(): CountdownRecord[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    // One of each kind: the first one stored wins.
    const seen = new Set<TimerKind>()
    return parsed.filter(valid).filter((t) => !seen.has(t.kind) && Boolean(seen.add(t.kind)))
  } catch {
    return []
  }
}

export function writeTimers(timers: readonly CountdownRecord[]): void {
  try {
    if (timers.length === 0) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(timers))
  } catch {
    /* the countdowns still run for this visit; they just will not survive a reload */
  }
}
