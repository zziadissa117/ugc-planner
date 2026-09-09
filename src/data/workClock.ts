// How long he has been working today.
//
// He asked for this on the home screen - "press start working and it helps me
// know how long ive been working for, i dont want it to reset when i leave the
// now page" - and it is deliberately NOT the timer CLAUDE.md says the filming
// path must never have. That one asked him to plan a window before he could
// start; this one only reports what has already happened, and nothing anywhere
// is compared against it.
//
// Client-side state, like the sync watermark and the seed marker: how long he
// sat at his desk is a fact about this device and this evening, not about the
// account, and syncing it would have two laptops arguing about one stopwatch.
// So localStorage, not a table - and no schema change to sync, back up or
// migrate for something that resets every morning anyway.

import { localToday } from './index'

const KEY = 'ugc-planner.work_clock'

export interface WorkDay {
  /** The local day this belongs to. A new day starts the count again. */
  date: string
  /** Milliseconds banked in finished stretches today. */
  bankedMs: number
  /** When the current stretch began, or null when the clock is paused. */
  startedAt: string | null
}

export function emptyDay(date = localToday()): WorkDay {
  return { date, bankedMs: 0, startedAt: null }
}

/** Total worked today, including the stretch still running. */
export function elapsedMs(day: WorkDay, now = Date.now()): number {
  if (day.startedAt === null) return day.bankedMs
  const running = now - new Date(day.startedAt).getTime()
  // A clock started before the machine's own clock was corrected backwards
  // would otherwise subtract time from the day.
  return day.bankedMs + Math.max(0, running)
}

export function isRunning(day: WorkDay): boolean {
  return day.startedAt !== null
}

/** Starts the clock, or leaves it alone when it is already going. */
export function start(day: WorkDay, at = new Date()): WorkDay {
  if (day.startedAt !== null) return day
  return { ...day, startedAt: at.toISOString() }
}

/** Banks the running stretch and stops. */
export function pause(day: WorkDay, now = Date.now()): WorkDay {
  if (day.startedAt === null) return day
  return { date: day.date, bankedMs: elapsedMs(day, now), startedAt: null }
}

/** Back to nothing, for today only. */
export function reset(day: WorkDay): WorkDay {
  return emptyDay(day.date)
}

/** Rolls the record onto `today` if it belongs to an earlier day.
 *
 *  A stretch left running overnight is banked into the day it started, not
 *  carried into the new one: he went to bed, and reporting sixteen hours
 *  worked would be worse than losing the tail of an evening he was not at. */
export function forDate(day: WorkDay, today = localToday()): WorkDay {
  return day.date === today ? day : emptyDay(today)
}

/** hh:mm:ss, or mm:ss under an hour. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const seconds = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`
}

/** Stretches of the day worth noticing. Passing one is a state, so it may be
 *  coloured; it is not a badge for its own sake. */
export const MILESTONES_MS = [30, 60, 120, 180].map((minutes) => minutes * 60_000)

export function readWorkDay(today = localToday()): WorkDay {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return emptyDay(today)
    const parsed = JSON.parse(raw) as Partial<WorkDay>
    const day: WorkDay = {
      date: typeof parsed.date === 'string' ? parsed.date : today,
      bankedMs: typeof parsed.bankedMs === 'number' && parsed.bankedMs >= 0 ? parsed.bankedMs : 0,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : null,
    }
    return forDate(day, today)
  } catch {
    // Private mode, blocked storage, or something else wrote nonsense here.
    // A stopwatch is not worth failing a screen over.
    return emptyDay(today)
  }
}

export function writeWorkDay(day: WorkDay): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(day))
  } catch {
    /* nothing to do - the clock still runs for this session */
  }
}
