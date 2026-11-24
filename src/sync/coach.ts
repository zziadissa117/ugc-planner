// The coach view: the owner sees each student's week and leaves them notes
// (the `coach` function). Owner only - the function answers `enabled: false`
// to anyone else, and listStudents returns null, so nothing shows.
//
// A student's rows are theirs alone under RLS; the function reads them with
// the service role after checking the caller is the owner (_shared/owner.ts).
// Notes he writes land in coach_notes against the student, and reach the
// student's planner by the ordinary sync pull (read only for them).

import { toAiError } from '../ai/errors'
import type { Campaign, CampaignAccount, EarningsEvent, IdeateNote, PlanBlock, UserSettings, Video, VideoPost } from '../data'
import { getSupabaseClient } from './auth'
import type { PostizPostsAnswer, PostizRange } from './postizPosts'

/** A note from the coach to one student - the shape of a coach_notes row. */
export interface CoachNoteRow {
  id: string
  /** The student it is for. */
  user_id: string
  /** The coach who wrote it. */
  author_id: string
  campaign_id: string | null
  /** A Postiz post id, when the note is about one video. */
  post_id: string | null
  /** That video's live link, kept so the note still points somewhere. */
  post_url: string | null
  /** The Sunday that starts the week it is about, when it is about a week. */
  week_start: string | null
  body: string
  created_at: string
  updated_at: string
  /** Set when he deleted it; the coach function never returns those. */
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
  /** The latest time any of their rows changed. */
  lastActiveAt: string | null
}

/** Everything the coach view shows for one student and range. */
export interface StudentWeek {
  student: StudentSummary
  settings: UserSettings | null
  planBlocks: PlanBlock[]
  campaigns: Campaign[]
  accounts: CampaignAccount[]
  videos: Video[]
  videoPosts: VideoPost[]
  earnings: EarningsEvent[]
  ideateNotes: IdeateNote[]
  coachNotes: CoachNoteRow[]
  /** Trybe videos made in the range, counted from their rows. */
  trybeVideos: number
  /** Their Postiz posts in the range, read with their own key. */
  posts: PostizPostsAnswer
}

export interface CoachNoteInput {
  studentId: string
  /** Set to edit an existing note. */
  id?: string
  campaign_id: string | null
  post_id?: string | null
  post_url?: string | null
  week_start?: string | null
  body: string
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const client = getSupabaseClient()
  if (!client) throw new Error('Sign-in is not set up on this copy of the planner.')
  const { data, error } = await client.functions.invoke('coach', { body })
  if (error) throw new Error((await toAiError(error)).message)
  return data as T
}

/** His students, or null when the caller is not the owner (or signed out). */
export async function listStudents(): Promise<StudentSummary[] | null> {
  const client = getSupabaseClient()
  if (!client) return null
  const { data: session } = await client.auth.getSession()
  if (!session.session) return null
  const answer = await call<{ enabled: boolean; students?: StudentSummary[] }>({ action: 'students' })
  return answer.enabled ? (answer.students ?? []) : null
}

export async function loadStudent(studentId: string, range: PostizRange): Promise<StudentWeek> {
  const answer = await call<{ enabled: boolean; week?: StudentWeek }>({ action: 'student', student_id: studentId, from: range.from, to: range.to })
  if (!answer.enabled || !answer.week) throw new Error('Only the coach can open a student.')
  return answer.week
}

export async function saveCoachNote(note: CoachNoteInput): Promise<CoachNoteRow> {
  const answer = await call<{ note: CoachNoteRow }>({
    action: 'save_note',
    student_id: note.studentId,
    id: note.id,
    campaign_id: note.campaign_id,
    post_id: note.post_id ?? null,
    post_url: note.post_url ?? null,
    week_start: note.week_start ?? null,
    body: note.body,
  })
  return answer.note
}

export async function deleteCoachNote(id: string): Promise<void> {
  await call<{ deleted: boolean }>({ action: 'delete_note', id })
}
