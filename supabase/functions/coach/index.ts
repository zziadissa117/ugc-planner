// The coach view: the owner sees each student's week and leaves them notes.
// Contract: src/sync/coach.ts; design: docs/POSTIZ_AND_COACH.md.
//
//   POST { action: 'students' }
//     -> { enabled: true, students: [StudentSummary] }
//   POST { action: 'student', student_id, from: ISO, to: ISO }
//     -> { enabled: true, week: StudentWeek }
//   POST { action: 'save_note', student_id, id?, campaign_id, post_id, post_url, week_start, body }
//     -> { note: CoachNoteRow }
//   POST { action: 'delete_note', id }
//     -> { deleted: boolean }
//
// Owner only (_shared/owner.ts). Anyone else gets `{ enabled: false }` and
// nothing, whatever they asked, the way `invites` answers - so a student's
// planner has no coach screen rather than a broken one.
//
// A student is an account that came in through an invite link (a row in
// invite_uses). Nobody else's rows are ever read here: an id that is not a
// student is refused, so the owner gate cannot be turned into "read any
// account". Their rows are theirs alone under RLS, so this function reads them
// with the service role, after both checks.
//
// What the week holds: their settings, their weekly plan as last saved,
// campaigns and accounts (the account password is left out - the coach has no
// use for a student's login), the videos and posts that went out in the range,
// earnings in the range, ideate notes up to the range's end, every note from
// the coach, the Trybe videos made in the range (a count), and their Postiz
// posts in the range read with THEIR key - which spends their hourly Postiz
// allowance, shared with their own screens (_shared/postizPosts.ts).
//
// Notes land in coach_notes (docs/migrations/0025_coach_notes.sql) against the
// student and reach their planner by the ordinary sync pull, whose cursor is
// updated_at - so every insert and every edit sets it here; there is no
// trigger. Pulls never delete, so deleting a note dates it (deleted_at) and
// moves updated_at: the deletion arrives like an edit and the planner stops
// showing it.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { jsonResponse, requireUser, serviceClient } from '../_shared/claude.ts'
import { type StudentSummary, checkNote, dayNearest, isUuid, latestByUser, latestSave } from '../_shared/coachRules.ts'
import { isOwner } from '../_shared/owner.ts'
import { readPostizPosts } from '../_shared/postizPosts.ts'
import { checkRange } from '../_shared/postizRules.ts'

type Db = ReturnType<typeof serviceClient>

interface UseRow {
  user_id: string
  email: string | null
  joined_at: string
}

/** Where a student's activity shows, and the column that dates it. The
 *  latest of these is their lastActiveAt. */
const ACTIVITY: readonly (readonly [string, string])[] = [
  ['user_settings', 'updated_at'],
  ['plan_blocks', 'updated_at'],
  ['campaigns', 'updated_at'],
  ['campaign_accounts', 'updated_at'],
  ['videos', 'updated_at'],
  ['video_posts', 'updated_at'],
  ['earnings_events', 'occurred_at'],
  ['trybe_videos', 'updated_at'],
  ['ideate_notes', 'updated_at'],
]
/** One query per table for the whole class, newest first, this many rows.
 *  A student none of whose rows in a table make the cut has nothing there
 *  newer than the cut-off, so their latest comes from the other tables -
 *  user_settings has one row each and always makes it. */
const ACTIVITY_ROWS = 1000

/** The rows of an answer, or an error naming the table. */
function rowsOf<T>(table: string, answer: { data: unknown; error: { message: string } | null }): T[] {
  if (answer.error) throw new Error(`${table}: ${answer.error.message}`)
  return (answer.data ?? []) as T[]
}

async function studentUse(db: Db, studentId: string): Promise<UseRow | null> {
  const { data, error } = await db.from('invite_uses').select('user_id, email, joined_at').eq('user_id', studentId).maybeSingle()
  if (error) throw new Error(`invite_uses: ${error.message}`)
  return data as UseRow | null
}

async function summaries(db: Db, uses: readonly UseRow[]): Promise<StudentSummary[]> {
  if (uses.length === 0) return []
  const ids = uses.map((u) => u.user_id)
  const [settingsAnswer, keysAnswer, ...activity] = await Promise.all([
    db.from('user_settings').select('user_id, student_name, goal, onboarded_at').in('user_id', ids),
    db.from('user_ai_keys').select('user_id').eq('provider', 'postiz').in('user_id', ids),
    ...ACTIVITY.map(([table, column]) =>
      db.from(table).select(`user_id, ${column}`).in('user_id', ids).order(column, { ascending: false }).limit(ACTIVITY_ROWS),
    ),
  ])
  const settings = rowsOf<{ user_id: string; student_name: string | null; goal: string | null; onboarded_at: string | null }>(
    'user_settings',
    settingsAnswer,
  )
  const connected = new Set(rowsOf<{ user_id: string }>('user_ai_keys', keysAnswer).map((k) => k.user_id))
  // A table this project does not have yet (0024 not run) just adds nothing
  // to a "latest" - it is not worth failing the list over.
  const last = latestByUser(
    activity.flatMap((answer, i) =>
      answer.error
        ? []
        : ((answer.data ?? []) as unknown as Record<string, string | null>[]).map((r) => ({
            user_id: String(r.user_id),
            at: r[ACTIVITY[i][1]],
          })),
    ),
  )
  const byId = new Map(settings.map((s) => [s.user_id, s]))
  return uses
    .map((u) => {
      const s = byId.get(u.user_id)
      return {
        id: u.user_id,
        email: u.email,
        name: s?.student_name ?? null,
        goal: s?.goal ?? null,
        joinedAt: u.joined_at,
        onboardedAt: s?.onboarded_at ?? null,
        postizConnected: connected.has(u.user_id),
        lastActiveAt: last.get(u.user_id) ?? null,
      }
    })
    .sort((a, b) => (a.name ?? a.email ?? a.id).localeCompare(b.name ?? b.email ?? b.id, undefined, { sensitivity: 'base' }))
}

async function studentWeek(db: Db, use: UseRow, from: string, to: string) {
  const id = use.user_id
  // earned_on and week_start are calendar days; the range is instants.
  const fromDay = dayNearest(from)
  const toDay = dayNearest(to)

  const [summary, settings, blocks, campaigns, accounts, videoPosts, videosOut, earnings, ideate, notes, trybe, posts] = await Promise.all([
    summaries(db, [use]),
    db.from('user_settings').select('*').eq('user_id', id).maybeSingle(),
    db.from('plan_blocks').select('*').eq('user_id', id),
    db.from('campaigns').select('*').eq('user_id', id).order('created_at', { ascending: true }),
    db.from('campaign_accounts').select('*').eq('user_id', id).order('sort_order', { ascending: true }),
    db.from('video_posts').select('*').eq('user_id', id).gte('posted_at', from).lt('posted_at', to).order('posted_at', { ascending: true }),
    db.from('videos').select('*').eq('user_id', id).gte('posted_at', from).lt('posted_at', to),
    db.from('earnings_events').select('*').eq('user_id', id).gte('earned_on', fromDay).lt('earned_on', toDay).order('occurred_at', { ascending: true }),
    db.from('ideate_notes').select('*').eq('user_id', id).lt('week_start', toDay).order('week_start', { ascending: false }).limit(500),
    db.from('coach_notes').select('*').eq('user_id', id).is('deleted_at', null).order('created_at', { ascending: false }).limit(500),
    db.from('trybe_videos').select('id', { count: 'exact', head: true }).eq('user_id', id).gte('made_at', from).lt('made_at', to),
    readPostizPosts(id, { from, to }),
  ])

  if (settings.error) throw new Error(`user_settings: ${settings.error.message}`)
  if (trybe.error) throw new Error(`trybe_videos: ${trybe.error.message}`)

  // A destination added in the range can belong to a video that first went
  // out before it: those videos too.
  const postRows = rowsOf<{ video_id: string }>('video_posts', videoPosts)
  const videos = rowsOf<{ id: string }>('videos', videosOut)
  const have = new Set(videos.map((v) => v.id))
  const missing = [...new Set(postRows.map((p) => p.video_id))].filter((v) => !have.has(v))
  if (missing.length > 0) {
    videos.push(...rowsOf<{ id: string }>('videos', await db.from('videos').select('*').eq('user_id', id).in('id', missing)))
  }

  return {
    student: summary[0],
    settings: settings.data ?? null,
    planBlocks: latestSave(rowsOf<{ updated_at: string }>('plan_blocks', blocks)),
    campaigns: rowsOf('campaigns', campaigns),
    accounts: rowsOf<Record<string, unknown>>('campaign_accounts', accounts).map((a) => ({ ...a, password: null })),
    videos,
    videoPosts: postRows,
    earnings: rowsOf('earnings_events', earnings),
    ideateNotes: rowsOf('ideate_notes', ideate),
    coachNotes: rowsOf('coach_notes', notes),
    trybeVideos: trybe.count ?? 0,
    posts,
  }
}

Deno.serve(async (req: Request) => {
  const auth = await requireUser(req)
  if (auth instanceof Response) return auth
  if (!isOwner(auth.userId)) return jsonResponse({ enabled: false })

  let body: Record<string, unknown>
  try {
    body = await req.json()
    if (!body || typeof body !== 'object') throw new Error()
  } catch {
    return jsonResponse({ error: 'Body must be JSON.' }, 400)
  }

  const db = serviceClient()

  try {
    if (body.action === 'students') {
      const { data, error } = await db.from('invite_uses').select('user_id, email, joined_at')
      if (error) return jsonResponse({ error: `Could not read the students (${error.message}).` }, 502)
      return jsonResponse({ enabled: true, students: await summaries(db, (data ?? []) as UseRow[]) })
    }

    if (body.action === 'student') {
      if (!isUuid(body.student_id)) return jsonResponse({ error: 'student_id is required.' }, 400)
      const range = checkRange(body.from, body.to)
      if (typeof range === 'string') return jsonResponse({ error: range }, 400)
      const use = await studentUse(db, body.student_id)
      if (!use) return jsonResponse({ error: 'That account is not one of your students.' }, 404)
      return jsonResponse({ enabled: true, week: await studentWeek(db, use, range.from, range.to) })
    }

    if (body.action === 'save_note') {
      const note = checkNote(body)
      if (typeof note === 'string') return jsonResponse({ error: note }, 400)
      if (!(await studentUse(db, note.student_id))) return jsonResponse({ error: 'That account is not one of your students.' }, 404)
      if (note.campaign_id) {
        const { data, error } = await db
          .from('campaigns')
          .select('id')
          .eq('id', note.campaign_id)
          .eq('user_id', note.student_id)
          .maybeSingle()
        if (error) return jsonResponse({ error: `Could not check the campaign (${error.message}).` }, 502)
        if (!data) return jsonResponse({ error: "That campaign is not this student's." }, 400)
      }
      // updated_at on every write: it is the pull's cursor, and nothing else
      // sets it.
      const now = new Date().toISOString()
      const columns = {
        campaign_id: note.campaign_id,
        post_id: note.post_id,
        post_url: note.post_url,
        week_start: note.week_start,
        body: note.body,
        updated_at: now,
      }
      if (note.id) {
        const { data, error } = await db
          .from('coach_notes')
          .update(columns)
          .eq('id', note.id)
          .eq('author_id', auth.userId)
          .eq('user_id', note.student_id)
          .is('deleted_at', null)
          .select('*')
          .maybeSingle()
        if (error) return jsonResponse({ error: `Could not save the note (${error.message}).` }, 502)
        if (!data) return jsonResponse({ error: 'That note is gone, or it is not yours to edit.' }, 404)
        return jsonResponse({ note: data })
      }
      const { data, error } = await db
        .from('coach_notes')
        .insert({ id: crypto.randomUUID(), user_id: note.student_id, author_id: auth.userId, ...columns, created_at: now })
        .select('*')
        .single()
      if (error) return jsonResponse({ error: `Could not save the note (${error.message}).` }, 502)
      return jsonResponse({ note: data })
    }

    if (body.action === 'delete_note') {
      if (!isUuid(body.id)) return jsonResponse({ error: 'id is required.' }, 400)
      const now = new Date().toISOString()
      const { data, error } = await db
        .from('coach_notes')
        .update({ deleted_at: now, updated_at: now })
        .eq('id', body.id)
        .eq('author_id', auth.userId)
        .is('deleted_at', null)
        .select('id')
      if (error) return jsonResponse({ error: `Could not delete the note (${error.message}).` }, 502)
      return jsonResponse({ deleted: (data ?? []).length > 0 })
    }
  } catch (error) {
    return jsonResponse({ error: `Could not read the student's rows (${error instanceof Error ? error.message : String(error)}).` }, 502)
  }

  return jsonResponse({ error: 'action must be students, student, save_note or delete_note.' }, 400)
})
