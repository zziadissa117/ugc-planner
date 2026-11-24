// The pure half of the `coach` function: checking a note before it is
// written, which plan blocks are the latest save, a student's last activity,
// and which calendar days a range covers. No Deno, no database, so vitest runs
// it as it is (src/coachRules.test.ts).
//
// The row types restate src/sync/coach.ts - Deno cannot import across the
// src/ boundary. The test file checks they still match at compile time.

/** A coach_notes row (docs/migrations/0025_coach_notes.sql). */
export interface CoachNoteRow {
  id: string
  user_id: string
  author_id: string
  campaign_id: string | null
  post_id: string | null
  post_url: string | null
  week_start: string | null
  body: string
  created_at: string
  updated_at: string
  /** Set when he deleted it; never returned by the coach function. */
  deleted_at: string | null
}

export interface StudentSummary {
  id: string
  email: string | null
  name: string | null
  goal: string | null
  joinedAt: string
  onboardedAt: string | null
  postizConnected: boolean
  lastActiveAt: string | null
}

export const NOTE_MAX_CHARS = 4000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/** A YYYY-MM-DD that is a real date and a Sunday (the planner's weeks start
 *  on Sunday; coach_notes checks the same). */
export function isSunday(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const at = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value && at.getUTCDay() === 0
}

/** The columns a save writes, checked. */
export interface NoteFields {
  id: string | null
  student_id: string
  campaign_id: string | null
  post_id: string | null
  post_url: string | null
  week_start: string | null
  body: string
}

const optionalText = (value: unknown): string | null | undefined => {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return undefined
  const v = value.trim()
  return v === '' ? null : v
}

/** A save_note body as columns, or why it cannot be saved. */
export function checkNote(body: Record<string, unknown>): NoteFields | string {
  if (!isUuid(body.student_id)) return 'student_id is required.'
  const id = body.id === undefined || body.id === null ? null : body.id
  if (id !== null && !isUuid(id)) return 'id must be a note id.'
  const campaign = body.campaign_id === undefined || body.campaign_id === null ? null : body.campaign_id
  if (campaign !== null && !isUuid(campaign)) return 'campaign_id must be a campaign id or null.'

  const text = typeof body.body === 'string' ? body.body.trim() : ''
  if (text === '') return 'Write the note first.'
  if (text.length > NOTE_MAX_CHARS) return `A note can be at most ${NOTE_MAX_CHARS} characters.`

  const postId = optionalText(body.post_id)
  if (postId === undefined || (postId !== null && postId.length > 200)) return 'post_id must be a Postiz post id or null.'
  const postUrl = optionalText(body.post_url)
  if (postUrl === undefined || (postUrl !== null && (!/^https?:\/\/\S+$/i.test(postUrl) || postUrl.length > 2000))) {
    return 'post_url must be a link or null.'
  }
  const week = optionalText(body.week_start)
  if (week === undefined || (week !== null && !isSunday(week))) return 'week_start must be a Sunday (YYYY-MM-DD) or null.'

  return { id, student_id: body.student_id, campaign_id: campaign, post_id: postId, post_url: postUrl, week_start: week, body: text }
}

/** His week as he last saved it: every block of one save shares updated_at,
 *  so the blocks with the latest one. */
export function latestSave<T extends { updated_at: string }>(blocks: readonly T[]): T[] {
  let latest = -Infinity
  for (const b of blocks) latest = Math.max(latest, Date.parse(b.updated_at))
  return blocks.filter((b) => Date.parse(b.updated_at) === latest)
}

/** The latest time per user across rows from several tables. */
export function latestByUser(rows: readonly { user_id: string; at: string | null }[]): Map<string, string> {
  const best = new Map<string, number>()
  for (const r of rows) {
    const at = r.at ? Date.parse(r.at) : NaN
    if (!Number.isFinite(at)) continue
    if (at > (best.get(r.user_id) ?? -Infinity)) best.set(r.user_id, at)
  }
  return new Map([...best].map(([id, at]) => [id, new Date(at).toISOString()]))
}

/** The calendar day an instant stands for when it is a day boundary: the day
 *  whose midnight is nearest, in UTC. A range arrives as instants - the
 *  coach's local midnights - and earned_on and week_start are plain dates;
 *  midnight anywhere from UTC-11 to UTC+11 rounds to its own date. */
export function dayNearest(instant: string): string {
  return new Date(Date.parse(instant) + 12 * 3_600_000).toISOString().slice(0, 10)
}
