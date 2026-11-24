import { describe, expect, it } from 'vitest'

import { cannotPlace, planIcs, planProblems, segmentsFor, trybeMinutes, type DraftBlock } from './weeklyPlan'

const record = (weekday: number, minutes = 120, start = 18 * 60): DraftBlock => ({ kind: 'record', weekday, start_minute: start, duration_minutes: minutes })
const ideate = (weekday: number): DraftBlock => ({ kind: 'ideate', weekday, start_minute: 10 * 60, duration_minutes: 60 })

describe('a recording day', () => {
  it.each([
    [60, 30, 30],
    [90, 45, 45],
    [120, 60, 60],
    [180, 60, 120],
  ])('of %i minutes is %i of Trybe videos then %i of the rest', (minutes, trybe, rest) => {
    expect(trybeMinutes(minutes)).toBe(trybe)
    const week = [record(0, minutes), record(2, minutes), record(4, minutes)]
    expect(segmentsFor(week[0], week).map((s) => s.duration_minutes)).toEqual([trybe, rest])
  })

  it('is base UGC on the first two and media maxing on the third, in week order', () => {
    const week = [record(4), record(0), record(2)]
    const second = (b: DraftBlock) => segmentsFor(b, week)[1].kind
    expect([second(week[1]), second(week[2]), second(week[0])]).toEqual(['base', 'base', 'media_maxing'])
    expect(segmentsFor(week[1], week)[1].start_minute).toBe(18 * 60 + 60)
  })
})

describe('the week', () => {
  it('is ready with three recording days on different days and an ideate day', () => {
    expect(planProblems([record(0), record(2), record(4), ideate(5)])).toEqual([])
  })

  it('says what is missing, in plain words', () => {
    expect(planProblems([record(0)])).toEqual([
      'Place 2 more recording sessions.',
      'Pick at least one day to ideate, A/B test and improve.',
    ])
  })

  it('refuses a fourth recording day, a second on the same day, or an overlap', () => {
    const week = [record(0), record(2), record(4)]
    expect(cannotPlace(week, record(6))).toMatch(/three recording days/)
    expect(cannotPlace([record(0)], record(0, 120, 8 * 60))).toBe('One recording session a day.')
    expect(cannotPlace([record(0)], { kind: 'ideate', weekday: 0, start_minute: 19 * 60, duration_minutes: 60 })).toBe('Something is already there.')
    expect(cannotPlace([], record(0, 180, 22 * 60))).toMatch(/past midnight/)
    expect(cannotPlace(week, ideate(1))).toBeNull()
  })
})

describe('the Google Calendar file', () => {
  it('holds one weekly event per block, in his time zone', () => {
    const week = [record(0), record(2), record(4), ideate(5)]
    const ics = planIcs(week, 'America/Toronto', new Date(2026, 10, 25))
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(4)
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO')
    expect(ics).toContain('DTSTART;TZID=America/Toronto:20261123T180000')
    expect(ics).toContain('SUMMARY:Record: 1h Trybe videos + 1h Media maxing')
  })
})
