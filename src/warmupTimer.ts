// The warm-up timer's state, kept as timestamps rather than as a number that
// counts down.
//
// It used to be a `secondsLeft` in a component's state, ticking once a second.
// Leaving the Now screen unmounted the component and the count was gone, and
// even staying put, a backgrounded tab throttles its timers so the number
// drifted. A timer is instead a start and an END TIME; what is left is always
// the end minus the clock, so it is right after a tab switch, a page change, a
// reload, or an hour away.

const STORAGE_KEY = 'ugc-planner.warmup_timers'

export interface WarmupTimerRecord {
  accountId: string
  platform: string
  handle: string | null
  campaignName: string
  /** The sitting's length, kept so the event recorded at the end carries the
   *  minutes this timer was actually set for. */
  minutes: number
  startedAt: number
  endsAt: number
  /** Set once the chime has gone off, so it sounds once per timer and a reload
   *  after it finished does not ring it again. */
  alerted: boolean
}

/** Whole seconds remaining, never negative. Rounded up, so it reads 00:01 until
 *  the very moment it hits zero instead of showing 00:00 a second early. */
export function secondsLeft(timer: WarmupTimerRecord, now: number): number {
  return Math.max(0, Math.ceil((timer.endsAt - now) / 1000))
}

export function isFinished(timer: WarmupTimerRecord, now: number): boolean {
  return now >= timer.endsAt
}

export function startTimer(
  input: Pick<WarmupTimerRecord, 'accountId' | 'platform' | 'handle' | 'campaignName' | 'minutes'>,
  now: number,
): WarmupTimerRecord {
  return { ...input, startedAt: now, endsAt: now + input.minutes * 60_000, alerted: false }
}

export function formatClock(seconds: number): string {
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function valid(value: unknown): value is WarmupTimerRecord {
  const t = value as WarmupTimerRecord
  return (
    typeof t === 'object' &&
    t !== null &&
    typeof t.accountId === 'string' &&
    typeof t.platform === 'string' &&
    typeof t.campaignName === 'string' &&
    typeof t.minutes === 'number' &&
    typeof t.startedAt === 'number' &&
    typeof t.endsAt === 'number' &&
    typeof t.alerted === 'boolean'
  )
}

export function readTimers(): WarmupTimerRecord[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(valid) : []
  } catch {
    return []
  }
}

export function writeTimers(timers: readonly WarmupTimerRecord[]): void {
  try {
    if (timers.length === 0) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(timers))
  } catch {
    /* the timers still run for this session; they just will not survive a reload */
  }
}
