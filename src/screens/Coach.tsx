// The coach view: his students, and one student's campaigns as IDEATE shows
// them to the student - with his notes to them editable here, and their own
// notes read only. Owner only: the `coach` function answers nobody else
// (src/sync/coach.ts), and then this says so and nothing more.
//
// Online only. A student's rows live on their devices and the server, not on
// his, so there is nothing to show without a connection.

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'

import { IdeateBoard, type NoteEditor, type PostsState } from '../components/IdeateBoard'
import { BackIcon, ChevronRightIcon } from '../components/icons'
import { CARD_CLASS, buttonClass } from '../components/styles'
import { Button, ScreenHeader, StateDot } from '../components/ui'
import { useConnection } from '../components/useConnection'
import { COACH_NOTE_MAX_LENGTH } from '../data/constraints'
import { campaignsInOrder, dayLabel, instant, localDay, periodRange, type IdeatePeriod } from '../data/ideate'
import { deleteCoachNote, listStudents, loadStudent, saveCoachNote, type CoachNoteRow, type StudentSummary, type StudentWeek } from '../sync/coach'

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

function displayName(student: StudentSummary): string {
  return student.name?.trim() || student.email || 'Student'
}

/** "just now", "5m ago", "3h ago", "2d ago", then the date. */
function ago(iso: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - instant(iso)) / 60_000)
  if (!Number.isFinite(minutes)) return ''
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h ago`
  if (minutes < 7 * 24 * 60) return `${Math.floor(minutes / (24 * 60))}d ago`
  return shortDate(iso)
}

/** "Nov 3" */
function shortDate(iso: string): string {
  return dayLabel(localDay(iso)).replace(/^\w+, /, '')
}

function NotForYou({ message = 'Only the coach can open this.' }: { message?: string }) {
  return (
    <section className="mx-auto flex max-w-3xl flex-col items-start gap-4">
      <p className="text-base text-text-dim">{message}</p>
      <Link to="/" className={buttonClass('quiet')}>
        Home
      </Link>
    </section>
  )
}

// --- /coach --------------------------------------------------------------------------

type ListState = { kind: 'loading' } | { kind: 'offline' } | { kind: 'denied' } | { kind: 'failed'; message: string } | { kind: 'ready'; students: StudentSummary[] }

export function Coach() {
  const { online, tick } = useConnection()
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{ key: string; state: ListState } | null>(null)
  const key = `${tick}|${retry}`

  useEffect(() => {
    if (!online) return
    let cancelled = false
    const put = (state: ListState) => {
      if (!cancelled) setResult({ key, state })
    }
    listStudents()
      .then((students) => put(students === null ? { kind: 'denied' } : { kind: 'ready', students }))
      .catch((error: unknown) => put({ kind: 'failed', message: describe(error) }))
    return () => {
      cancelled = true
    }
  }, [key, online])

  const state: ListState = !online ? { kind: 'offline' } : result?.key === key ? result.state : { kind: 'loading' }

  if (state.kind === 'denied') return <NotForYou />

  const now = new Date()
  const students =
    state.kind === 'ready'
      ? [...state.students].sort(
          (a, b) =>
            (b.lastActiveAt ? instant(b.lastActiveAt) || 0 : -1) - (a.lastActiveAt ? instant(a.lastActiveAt) || 0 : -1) ||
            displayName(a).localeCompare(displayName(b)),
        )
      : []

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-7">
      <ScreenHeader kicker="Coach" title="Students" />

      {state.kind === 'loading' ? <p className="text-base text-state-later">Loading…</p> : null}
      {state.kind === 'offline' ? <p className="text-base text-state-later">Offline. The coach view needs a connection.</p> : null}
      {state.kind === 'failed' ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-base text-state-blocked">Couldn't load your students: {state.message}</p>
          <Button size="small" onClick={() => setRetry((n) => n + 1)}>
            Try again
          </Button>
        </div>
      ) : null}

      {state.kind === 'ready' && students.length === 0 ? (
        <p className="text-base text-state-later">
          No students yet.{' '}
          <Link to="/settings" className="font-semibold text-brand hover:text-text">
            Invite links
          </Link>{' '}
          are in Setup.
        </p>
      ) : null}

      {students.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {students.map((student, index) => (
            <li key={student.id} className="settle-in" style={{ '--i': index } as CSSProperties}>
              <StudentCard student={student} now={now} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function StudentCard({ student, now }: { student: StudentSummary; now: Date }) {
  const name = displayName(student)
  return (
    <Link
      to={`/coach/${student.id}`}
      className={`${CARD_CLASS} press group flex h-full flex-col gap-3 p-5 transition-colors duration-200 hover:border-edge-lit`}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="display truncate text-xl text-text">{name}</span>
          {student.name?.trim() && student.email ? <span className="meta truncate text-state-later">{student.email}</span> : null}
        </span>
        <ChevronRightIcon className="mt-1 h-5 w-5 shrink-0 text-brand transition-transform duration-200 group-hover:translate-x-0.5" />
      </span>
      {student.goal?.trim() ? <span className="line-clamp-2 text-base text-text-dim">{student.goal.trim()}</span> : null}
      <span className="meta mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-state-later">
        <span>Joined {shortDate(student.joinedAt)}</span>
        <span>{student.lastActiveAt ? `Active ${ago(student.lastActiveAt, now)}` : 'Not active yet'}</span>
        <span className="flex items-center gap-2">
          <StateDot tone={student.postizConnected ? 'posted' : 'later'} />
          {student.postizConnected ? 'Postiz' : 'No Postiz'}
        </span>
      </span>
    </Link>
  )
}

// --- /coach/:studentId -----------------------------------------------------------------

type StudentState = { kind: 'loading' } | { kind: 'offline' } | { kind: 'denied'; message: string } | { kind: 'failed'; message: string } | { kind: 'ready' }

const DENIED = 'Only the coach can open a student.'

export function CoachStudent() {
  const { studentId = '' } = useParams()
  const [period, setPeriod] = useState<IdeatePeriod>('week')
  const range = useMemo(() => periodRange(period), [period])
  const { online, tick } = useConnection()
  const [retry, setRetry] = useState(0)
  // The last answer, kept while another period is read so the student stays
  // on screen; only the videos wait for it.
  const [week, setWeek] = useState<{ key: string; data: StudentWeek } | null>(null)
  const [failure, setFailure] = useState<{ key: string; state: StudentState } | null>(null)
  const [coachNotes, setCoachNotes] = useState<CoachNoteRow[]>([])
  const key = `${studentId}|${period}`
  const attempt = `${key}|${tick}|${retry}`

  useEffect(() => {
    if (!online) return
    let cancelled = false
    loadStudent(studentId, { from: range.from, to: range.to })
      .then((data) => {
        if (cancelled) return
        setWeek({ key: attempt, data })
        setCoachNotes(data.coachNotes)
        setFailure(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = describe(error)
        setFailure({ key: attempt, state: message === DENIED ? { kind: 'denied', message } : { kind: 'failed', message } })
      })
    return () => {
      cancelled = true
    }
  }, [studentId, range, attempt, online])

  const state: StudentState = !online
    ? { kind: 'offline' }
    : failure?.key === attempt
      ? failure.state
      : week?.key === attempt
        ? { kind: 'ready' }
        : { kind: 'loading' }

  const save = useCallback<NoteEditor['save']>(
    async (campaignId, draft) => {
      const row = await saveCoachNote({
        studentId,
        id: draft.id,
        campaign_id: campaignId,
        post_id: draft.postId,
        post_url: draft.postUrl,
        week_start: draft.weekStart,
        body: draft.body,
      })
      setCoachNotes((notes) => [row, ...notes.filter((n) => n.id !== row.id)])
    },
    [studentId],
  )
  const remove = useCallback<NoteEditor['remove']>(async (id) => {
    await deleteCoachNote(id)
    setCoachNotes((notes) => notes.filter((n) => n.id !== id))
  }, [])
  const coachEditor = useMemo<NoteEditor>(() => ({ save, remove }), [save, remove])

  if (state.kind === 'denied') return <NotForYou message={state.message} />

  // The student stays on screen while another period is read; only the
  // videos wait for it.
  const data = week && week.key.startsWith(`${studentId}|`) ? week.data : null
  const current = week !== null && week.key.startsWith(`${key}|`)
  const posts: PostsState =
    state.kind === 'offline'
      ? { kind: 'offline' }
      : state.kind === 'failed'
        ? { kind: 'failed', message: state.message }
        : current && data
          ? { kind: 'ready', answer: data.posts }
          : { kind: 'loading' }
  const student = data?.student ?? null
  const first = student?.name?.trim().split(/\s+/)[0]
  const campaigns = data ? campaignsInOrder(data.campaigns, data.accounts) : []

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-7">
      <div className="flex flex-col gap-4">
        <Link to="/coach" className="meta inline-flex items-center gap-1.5 self-start font-semibold text-state-later hover:text-text">
          <BackIcon className="h-4 w-4" />
          Students
        </Link>
        <ScreenHeader
          kicker="Coach"
          title={student ? displayName(student) : '\u00a0'}
          meta={student?.goal?.trim() || null}
          aside={
            student ? (
              <span className="meta flex items-center gap-2 text-state-later">
                <StateDot tone={student.postizConnected ? 'posted' : 'later'} />
                {student.postizConnected ? 'Postiz' : 'No Postiz'}
              </span>
            ) : null
          }
        />
      </div>

      {state.kind === 'offline' ? <p className="text-base text-state-later">Offline. The coach view needs a connection.</p> : null}
      {state.kind === 'failed' ? (
        <div className="flex flex-col items-start gap-3">
          {/* With the student already on screen, the reason shows where the
              videos would be. */}
          {data === null ? <p className="text-base text-state-blocked">Couldn't load this student: {state.message}</p> : null}
          <Button size="small" onClick={() => setRetry((n) => n + 1)}>
            Try again
          </Button>
        </div>
      ) : null}
      {data === null && state.kind === 'loading' ? <p className="text-base text-state-later">Loading…</p> : null}

      {data && campaigns.length === 0 ? <p className="text-base text-state-later">No campaigns yet.</p> : null}
      {data && campaigns.length > 0 ? (
        <IdeateBoard
          campaigns={campaigns}
          accounts={data.accounts}
          posts={posts}
          period={period}
          onPeriod={setPeriod}
          weekStart={range.weekStart}
          ownNotes={data.ideateNotes}
          coachNotes={coachNotes}
          coachEditor={coachEditor}
          ownTitle={first ? `${first}'s notes` : 'Their notes'}
          showCoachNotes
          subject="student"
          coachMaxLength={COACH_NOTE_MAX_LENGTH}
        />
      ) : null}
    </section>
  )
}
