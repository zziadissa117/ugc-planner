// Today off the saved week: which session is on, which are to come, when the
// next one is, and where the week starts for the Trybe count.

import { describe, expect, it } from 'vitest'

import type { DraftBlock } from './data/weeklyPlan'
import {
  dayBounds,
  describeNext,
  headline,
  nextSession,
  segmentAt,
  sessionsToday,
  timeRange,
  weekBounds,
} from './todaySchedule'

// Stored weekdays: 0 = Monday. 2026-11-22 is a Sunday, so 24 November is a
// Tuesday (1) - and dates here are local, like the device's.
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m)
const WEEK: DraftBlock[] = [
  { kind: 'record', weekday: 1, start_minute: 18 * 60, duration_minutes: 120 }, // Tue 6 pm
  { kind: 'ideate', weekday: 2, start_minute: 10 * 60, duration_minutes: 60 }, // Wed 10 am
  { kind: 'record', weekday: 3, start_minute: 18 * 60, duration_minutes: 120 }, // Thu 6 pm
  { kind: 'record', weekday: 5, start_minute: 9 * 60, duration_minutes: 120 }, // Sat 9 am
]

describe("today's sessions", () => {
  it('marks the one on now, the ones to come and the ones over', () => {
    const tuesday = [...WEEK, { kind: 'backup' as const, weekday: 1, start_minute: 8 * 60, duration_minutes: 120 }]
    expect(sessionsToday(tuesday, at(24, 7)).map((s) => s.state)).toEqual(['later', 'later'])
    expect(sessionsToday(tuesday, at(24, 9)).map((s) => s.state)).toEqual(['now', 'later'])
    expect(sessionsToday(tuesday, at(24, 18, 30)).map((s) => s.state)).toEqual(['over', 'now'])
    // The end minute is not part of it.
    expect(sessionsToday(tuesday, at(24, 20)).map((s) => s.state)).toEqual(['over', 'over'])
  })

  it('says what is on in the headline', () => {
    expect(headline(sessionsToday(WEEK, at(24, 18, 30)))).toBe('Recording now')
    expect(headline(sessionsToday(WEEK, at(24, 12)))).toBe('Recording at 6:00 pm')
    expect(headline(sessionsToday(WEEK, at(25, 10, 15)))).toBe('Ideating now')
    expect(headline(sessionsToday(WEEK, at(24, 21)))).toBe('No more sessions today')
    expect(headline(sessionsToday(WEEK, at(23, 12)))).toBe('No session today')
  })

  it('knows which part of a recording session is on', () => {
    expect(segmentAt(WEEK[0], WEEK, 18 * 60 + 30)?.kind).toBe('trybe')
    expect(segmentAt(WEEK[0], WEEK, 19 * 60)?.kind).toBe('base')
    // Saturday is the third recording day of a week that starts on Sunday.
    expect(segmentAt(WEEK[3], WEEK, 10 * 60 + 30)?.kind).toBe('media_maxing')
    expect(segmentAt(WEEK[1], WEEK, 10 * 60 + 30)).toBeNull()
  })
})

describe('the next session', () => {
  it('is later today when there is one', () => {
    const next = nextSession(WEEK, at(24, 12))!
    expect(next.block).toBe(WEEK[0])
    expect(describeNext(next)).toBe('today 6:00 pm')
  })

  it('is tomorrow, by name after that', () => {
    expect(describeNext(nextSession(WEEK, at(24, 21))!)).toBe('tomorrow 10:00 am')
    expect(describeNext(nextSession(WEEK, at(26, 21))!)).toBe('Saturday 9:00 am')
    // Sunday night to Tuesday.
    expect(describeNext(nextSession(WEEK, at(22, 12))!)).toBe('Tuesday 6:00 pm')
  })

  it('comes round to the same day next week when that is the only block', () => {
    const one: DraftBlock[] = [WEEK[0]]
    const next = nextSession(one, at(24, 21))!
    expect(next.daysAway).toBe(7)
    expect(describeNext(next)).toBe('Tuesday 6:00 pm')
  })

  it('is nothing with no week saved', () => {
    expect(nextSession([], at(24, 12))).toBeNull()
  })
})

describe('times and bounds', () => {
  it('writes a range the way a calendar does', () => {
    expect(timeRange(18 * 60, 20 * 60)).toBe('6:00 – 8:00 pm')
    expect(timeRange(11 * 60 + 30, 13 * 60 + 30)).toBe('11:30 am – 1:30 pm')
  })

  it('runs a day midnight to midnight, and a week Sunday to Sunday', () => {
    expect(dayBounds(at(24, 18))).toEqual({ from: at(24, 0), to: at(25, 0) })
    expect(weekBounds(at(24, 18))).toEqual({ from: at(22, 0), to: at(29, 0) })
    // A Sunday is the first day of its own week.
    expect(weekBounds(at(22, 0))).toEqual({ from: at(22, 0), to: at(29, 0) })
    expect(weekBounds(at(28, 23, 59))).toEqual({ from: at(22, 0), to: at(29, 0) })
  })
})
