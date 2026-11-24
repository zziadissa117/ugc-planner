// What today holds, off the saved week (plan_blocks) and the clock - for the
// TODAY screen. Pure, so the times are tested (todaySchedule.test.ts).
//
// Times are the device's own, like every other "today" in the app
// (localToday): the week is placed in his time zone on the device he places
// it on, and a session at 6 pm is 6 pm on the phone in his hand.

import type { PlanBlockKind } from './data'
import { WEEKDAYS, clock, planWeekday, segmentsFor, type DraftBlock, type Segment } from './data/weeklyPlan'

/** now = on right now, later = still to come today, over = finished. */
export type SessionState = 'now' | 'later' | 'over'

export interface TodaySession<T extends DraftBlock = DraftBlock> {
  block: T
  state: SessionState
  end: number
}

/** The minute of the day, 0 at midnight. */
export function minuteOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

/** Today's blocks in time order, each marked now, later or over. */
export function sessionsToday<T extends DraftBlock>(blocks: readonly T[], now: Date): TodaySession<T>[] {
  const weekday = planWeekday(now)
  const minute = minuteOfDay(now)
  return blocks
    .filter((b) => b.weekday === weekday)
    .sort((a, b) => a.start_minute - b.start_minute)
    .map((block) => {
      const end = block.start_minute + block.duration_minutes
      const state: SessionState = minute < block.start_minute ? 'later' : minute < end ? 'now' : 'over'
      return { block, state, end }
    })
}

/** The first block that has not started yet - later today, or on a day to
 *  come - and how many days away it is (0 = today, 1 = tomorrow). Null only
 *  when there is no week at all. */
export function nextSession<T extends DraftBlock>(blocks: readonly T[], now: Date): { block: T; daysAway: number } | null {
  if (blocks.length === 0) return null
  const minute = minuteOfDay(now)
  for (let daysAway = 0; daysAway <= 7; daysAway++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAway)
    const weekday = planWeekday(day)
    const first = blocks
      .filter((b) => b.weekday === weekday && (daysAway === 0 ? b.start_minute > minute : true))
      .sort((a, b) => a.start_minute - b.start_minute)[0]
    if (first) return { block: first, daysAway }
  }
  return null
}

/** "Next: tomorrow 6:00 pm", "Next: Friday 10:00 am". */
export function describeNext(next: { block: DraftBlock; daysAway: number }): string {
  const day = next.daysAway === 0 ? 'today' : next.daysAway === 1 ? 'tomorrow' : WEEKDAYS[next.block.weekday]
  return `${day} ${clock(next.block.start_minute)}`
}

/** The part of a recording session running at `minute`: Trybe first, then
 *  base UGC or media maxing. Null outside a recording session. */
export function segmentAt(block: DraftBlock, blocks: readonly DraftBlock[], minute: number): Segment | null {
  return segmentsFor(block, blocks).find((s) => minute >= s.start_minute && minute < s.start_minute + s.duration_minutes) ?? null
}

/** "6:00 – 8:00 pm", "11:30 am – 1:30 pm". */
export function timeRange(start: number, end: number): string {
  const a = clock(start)
  const b = clock(end)
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`
}

/** What a kind of session is called in a sentence. */
export const DOING: Record<PlanBlockKind, string> = {
  record: 'Recording',
  ideate: 'Ideating',
  backup: 'Backup session',
}

/** The screen's headline: what is on now, or next today, or that there is
 *  nothing left. */
export function headline(sessions: readonly TodaySession[]): string {
  const now = sessions.find((s) => s.state === 'now')
  if (now) return `${DOING[now.block.kind]} now`
  const later = sessions.find((s) => s.state === 'later')
  if (later) return `${DOING[later.block.kind]} at ${clock(later.block.start_minute)}`
  return sessions.length === 0 ? 'No session today' : 'No more sessions today'
}

/** Midnight today to midnight tomorrow, on this device. */
export function dayBounds(now: Date): { from: Date; to: Date } {
  return {
    from: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    to: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
  }
}

/** The week he reads, Sunday to Sunday: midnight on the Sunday that started
 *  it to midnight on the next. */
export function weekBounds(now: Date): { from: Date; to: Date } {
  const sunday = now.getDate() - now.getDay()
  return {
    from: new Date(now.getFullYear(), now.getMonth(), sunday),
    to: new Date(now.getFullYear(), now.getMonth(), sunday + 7),
  }
}
