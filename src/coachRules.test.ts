import { describe, expect, it } from 'vitest'

import { checkNote, dayNearest, isSunday, latestByUser, latestSave } from '../supabase/functions/_shared/coachRules'
import type * as Server from '../supabase/functions/_shared/coachRules'
import type * as Client from './sync/coach'

// The server restates the client's contract (Deno cannot import src/). These
// fail to compile the day the two stop matching.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const noteMatches: Same<Server.CoachNoteRow, Client.CoachNoteRow> = true
const summaryMatches: Same<Server.StudentSummary, Client.StudentSummary> = true

const STUDENT = '11111111-2222-4333-8444-555555555555'
const CAMPAIGN = '66666666-7777-4888-9999-000000000000'

describe('the contract', () => {
  it('matches src/sync/coach.ts', () => {
    expect([noteMatches, summaryMatches]).toEqual([true, true])
  })
})

describe('a note before it is saved', () => {
  const note = { student_id: STUDENT, campaign_id: CAMPAIGN, post_id: 'p1', post_url: 'https://www.tiktok.com/@s/video/1', week_start: '2026-11-22', body: '  Open on the result.  ' }

  it('is kept as written, trimmed', () => {
    expect(checkNote(note)).toEqual({
      id: null,
      student_id: STUDENT,
      campaign_id: CAMPAIGN,
      post_id: 'p1',
      post_url: 'https://www.tiktok.com/@s/video/1',
      week_start: '2026-11-22',
      body: 'Open on the result.',
    })
  })

  it('may be about no campaign, video or week', () => {
    expect(checkNote({ student_id: STUDENT, campaign_id: null, body: 'Good week.' })).toMatchObject({
      campaign_id: null,
      post_id: null,
      post_url: null,
      week_start: null,
    })
    expect(checkNote({ ...note, post_id: '', post_url: '', week_start: '' })).toMatchObject({ post_id: null, post_url: null, week_start: null })
  })

  it('needs a body of 1 to 4000 characters', () => {
    expect(checkNote({ ...note, body: '   ' })).toBe('Write the note first.')
    expect(checkNote({ ...note, body: 'x'.repeat(4001) })).toMatch(/at most 4000/)
    expect(typeof checkNote({ ...note, body: 'x'.repeat(4000) })).toBe('object')
  })

  it('refuses a week that does not start on a Sunday, and ids that are not ids', () => {
    expect(checkNote({ ...note, week_start: '2026-11-23' })).toMatch(/Sunday/)
    expect(checkNote({ ...note, student_id: 'me' })).toBe('student_id is required.')
    expect(checkNote({ ...note, campaign_id: 'Vertus' })).toMatch(/campaign_id/)
    expect(checkNote({ ...note, id: 7 })).toMatch(/note id/)
    expect(checkNote({ ...note, post_url: 'javascript:alert(1)' })).toMatch(/post_url/)
  })
})

describe('dates', () => {
  it('knows a Sunday', () => {
    expect(isSunday('2026-11-22')).toBe(true)
    expect(isSunday('2026-11-24')).toBe(false)
    expect(isSunday('2026-02-30')).toBe(false)
    expect(isSunday('22/11/2026')).toBe(false)
  })

  it("reads a range's bounds as the days they start, wherever the coach is", () => {
    // Toronto, Paris and UTC midnights on Sunday 22 November.
    expect(dayNearest('2026-11-22T05:00:00.000Z')).toBe('2026-11-22')
    expect(dayNearest('2026-11-21T23:00:00.000Z')).toBe('2026-11-22')
    expect(dayNearest('2026-11-22T00:00:00.000Z')).toBe('2026-11-22')
    // Sydney (UTC+11) and Honolulu (UTC-10).
    expect(dayNearest('2026-11-21T13:00:00.000Z')).toBe('2026-11-22')
    expect(dayNearest('2026-11-22T10:00:00.000Z')).toBe('2026-11-22')
  })
})

describe("a student's rows", () => {
  it('the weekly plan is the blocks of the latest save', () => {
    const blocks = [
      { id: 'a', updated_at: '2026-11-20T10:00:00+00:00' },
      { id: 'b', updated_at: '2026-11-23T09:00:00.5+00:00' },
      { id: 'c', updated_at: '2026-11-23T09:00:00.500Z' },
    ]
    expect(latestSave(blocks).map((b) => b.id)).toEqual(['b', 'c'])
    expect(latestSave([])).toEqual([])
  })

  it('the last activity is the latest time across every table', () => {
    const last = latestByUser([
      { user_id: 'u1', at: '2026-11-20T10:00:00+00:00' },
      { user_id: 'u2', at: null },
      { user_id: 'u1', at: '2026-11-23T10:00:00+00:00' },
      { user_id: 'u1', at: '2026-11-21T10:00:00+00:00' },
    ])
    expect(last.get('u1')).toBe('2026-11-23T10:00:00.000Z')
    expect(last.has('u2')).toBe(false)
  })
})
