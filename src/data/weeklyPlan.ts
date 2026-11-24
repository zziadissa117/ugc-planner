// The weekly recording plan, by fixed rules - no AI, nothing invented.
//
// A student records on three days a week, at a time he reserves, for 1h, 1.5h,
// 2h or 3h. Each recording day opens with Trybe videos (practice videos that
// are not posted: a timer, and as many as he can) and then base UGC, except
// the third, which ends with media maxing instead:
//
//   1h   -> 30m Trybe + 30m base / media maxing
//   1.5h -> 45m Trybe + 45m
//   2h   -> 1h Trybe  + 1h      (recommended)
//   3h   -> 1h Trybe  + 2h      (if he is really locked in)
//
// Other days he picks are for ideating, A/B testing and improving content, and
// one optional backup day catches a missed session.

import type { PlanBlock, PlanBlockKind } from './schema'

export const MINUTES_PER_DAY_OPTIONS = [60, 90, 120, 180] as const
export type MinutesPerDay = (typeof MINUTES_PER_DAY_OPTIONS)[number]
export const RECOMMENDED_MINUTES: MinutesPerDay = 120
export const RECORDING_DAYS = 3
export const IDEATE_MINUTES = 60

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
export const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export type SegmentKind = 'trybe' | 'base' | 'media_maxing'

export const SEGMENT_LABEL: Record<SegmentKind, string> = {
  trybe: 'Trybe videos',
  base: 'Base UGC',
  media_maxing: 'Media maxing',
}

export interface Segment {
  kind: SegmentKind
  start_minute: number
  duration_minutes: number
}

/** The plan's own shape, before it is saved. */
export type DraftBlock = Pick<PlanBlock, 'kind' | 'weekday' | 'start_minute' | 'duration_minutes'>

/** How long the Trybe part of a recording day runs. */
export function trybeMinutes(minutesPerDay: number): number {
  return minutesPerDay >= 120 ? 60 : minutesPerDay / 2
}

/** The recording blocks in week order: the third is the media maxing day. */
export function recordingOrder<T extends DraftBlock>(blocks: readonly T[]): T[] {
  return blocks.filter((b) => b.kind === 'record').sort((a, b) => a.weekday - b.weekday || a.start_minute - b.start_minute)
}

/** What a recording block holds, in order. */
export function segmentsFor(block: DraftBlock, blocks: readonly DraftBlock[]): Segment[] {
  if (block.kind !== 'record') return []
  const order = recordingOrder(blocks)
  const index = order.findIndex((b) => b.weekday === block.weekday && b.start_minute === block.start_minute)
  const trybe = trybeMinutes(block.duration_minutes)
  const rest = block.duration_minutes - trybe
  const second: SegmentKind = index === RECORDING_DAYS - 1 ? 'media_maxing' : 'base'
  return [
    { kind: 'trybe', start_minute: block.start_minute, duration_minutes: trybe },
    { kind: second, start_minute: block.start_minute + trybe, duration_minutes: rest },
  ]
}

const end = (b: DraftBlock) => b.start_minute + b.duration_minutes

export function overlaps(a: DraftBlock, b: DraftBlock): boolean {
  return a.weekday === b.weekday && a.start_minute < end(b) && b.start_minute < end(a)
}

/** What still stops the week from being saved, in plain words. Empty when it
 *  is ready. */
export function planProblems(blocks: readonly DraftBlock[]): string[] {
  const problems: string[] = []
  const record = blocks.filter((b) => b.kind === 'record')
  if (record.length < RECORDING_DAYS) problems.push(`Place ${RECORDING_DAYS - record.length} more recording session${RECORDING_DAYS - record.length === 1 ? '' : 's'}.`)
  if (record.length > RECORDING_DAYS) problems.push(`Three recording days only - remove ${record.length - RECORDING_DAYS}.`)
  if (new Set(record.map((b) => b.weekday)).size !== record.length) problems.push('Put each recording session on a different day.')
  if (!blocks.some((b) => b.kind === 'ideate')) problems.push('Pick at least one day to ideate, A/B test and improve.')
  if (blocks.filter((b) => b.kind === 'backup').length > 1) problems.push('One backup day at most.')
  if (blocks.some((b) => end(b) > 24 * 60)) problems.push('A session runs past midnight - start it earlier.')
  return problems
}

/** Whether a new block fits where he tapped: inside the day, on nothing else,
 *  and within the limits for its kind. Null when it fits, else why not. */
export function cannotPlace(blocks: readonly DraftBlock[], block: DraftBlock): string | null {
  if (end(block) > 24 * 60) return 'That runs past midnight - start earlier.'
  if (blocks.some((b) => overlaps(b, block))) return 'Something is already there.'
  if (block.kind === 'record') {
    const record = blocks.filter((b) => b.kind === 'record')
    if (record.length >= RECORDING_DAYS) return 'You already have your three recording days. Tap one to remove it first.'
    if (record.some((b) => b.weekday === block.weekday)) return 'One recording session a day.'
  }
  if (block.kind === 'backup' && blocks.some((b) => b.kind === 'backup')) return 'One backup day at most.'
  return null
}

export function durationFor(kind: PlanBlockKind, minutesPerDay: number): number {
  return kind === 'ideate' ? IDEATE_MINUTES : minutesPerDay
}

/** "6:00 pm" */
export function clock(minute: number): string {
  const h = Math.floor(minute / 60) % 24
  const m = minute % 60
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

/** "1h", "1.5h", "45m" */
export function hours(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const h = minutes / 60
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`
}

/** Today's weekday as the plan counts it: 0 = Monday. */
export function planWeekday(date: Date = new Date()): number {
  return (date.getDay() + 6) % 7
}

export const KIND_LABEL: Record<PlanBlockKind, string> = {
  record: 'Record',
  ideate: 'Ideate · A/B test · improve',
  backup: 'Backup day',
}

const ICS_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

/** The week as a calendar file Google Calendar imports: one weekly event per
 *  block, in his time zone, starting this week. */
export function planIcs(blocks: readonly DraftBlock[], timezone: string, now: Date = new Date()): string {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - planWeekday(now))
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const local = (day: Date, minute: number) => {
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minute)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`
  }
  const events = blocks.map((block, i) => {
    const day = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + block.weekday)
    const title =
      block.kind === 'record'
        ? `Record: ${segmentsFor(block, blocks).map((s) => `${hours(s.duration_minutes)} ${SEGMENT_LABEL[s.kind]}`).join(' + ')}`
        : KIND_LABEL[block.kind]
    return [
      'BEGIN:VEVENT',
      `UID:ugc-plan-${i}-${block.weekday}-${block.start_minute}@ugc-planner`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${timezone}:${local(day, block.start_minute)}`,
      `DTEND;TZID=${timezone}:${local(day, block.start_minute + block.duration_minutes)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${ICS_DAYS[block.weekday]}`,
      `SUMMARY:${title}`,
      'END:VEVENT',
    ].join('\r\n')
  })
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//UGC planner//Weekly plan//EN', ...events, 'END:VCALENDAR', ''].join('\r\n')
}
