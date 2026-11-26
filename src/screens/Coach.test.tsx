import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import type { Campaign, CampaignAccount, IdeateNote } from '../data'
import type { CoachNoteRow, StudentSummary, StudentWeek } from '../sync/coach'
import type { PostizPostView } from '../sync/postizPosts'
import { Coach, CoachStudent } from './Coach'

const listStudents = vi.fn()
const loadStudent = vi.fn()
const saveCoachNote = vi.fn()
const deleteCoachNote = vi.fn()
vi.mock('../sync/coach', () => ({
  listStudents: () => listStudents(),
  loadStudent: (...a: unknown[]) => loadStudent(...a),
  saveCoachNote: (...a: unknown[]) => saveCoachNote(...a),
  deleteCoachNote: (...a: unknown[]) => deleteCoachNote(...a),
}))

const STUDENT = 'student-1'
const COACH = 'coach-1'
// Tuesday, November 24 2026. The week is Sunday the 22nd to Saturday the 28th.
const NOW = new Date(2026, 10, 24, 15, 0)
const at = (day: number, hour = 12) => new Date(2026, 10, day, hour).toISOString()

const summary = (extra: Partial<StudentSummary> = {}): StudentSummary => ({
  id: STUDENT,
  email: 'sam@example.com',
  name: 'Sam Rivera',
  goal: '$2k a month from UGC',
  joinedAt: '2026-11-03T10:00:00Z',
  onboardedAt: '2026-11-03T10:30:00Z',
  postizConnected: true,
  lastActiveAt: new Date(2026, 10, 24, 12, 0).toISOString(),
  ...extra,
})

const campaign = { id: 'c1', name: 'Vertus', is_active: true, min_views: null, pay_per_video_cents: 2000, posts_per_week: 7 } as Campaign
const account = { id: 'a1', campaign_id: 'c1', platform: 'TikTok', handle: 'sam.ugc', is_active: true } as CampaignAccount

const post = (id: string, extra: Partial<PostizPostView> = {}): PostizPostView => ({
  id,
  group: null,
  platform: 'TikTok',
  handle: 'sam.ugc',
  url: `https://www.tiktok.com/@sam.ugc/video/${id}`,
  preview: null,
  previewKind: null,
  caption: '',
  status: 'posted',
  publishedAt: at(23),
  views: null,
  viewsAt: null,
  campaign: null,
  ...extra,
})

const ownNote: IdeateNote = {
  id: 'n1',
  user_id: STUDENT,
  campaign_id: 'c1',
  account_id: null,
  week_start: '2026-11-22',
  body: 'Try a green screen',
  created_at: '2026-11-23T10:00:00Z',
  updated_at: '2026-11-23T10:00:00Z',
}

const coachRow = (extra: Partial<CoachNoteRow> = {}): CoachNoteRow => ({
  id: 'cn1',
  user_id: STUDENT,
  author_id: COACH,
  campaign_id: 'c1',
  post_id: null,
  post_url: null,
  week_start: '2026-11-22',
  body: 'Cut the first two seconds',
  created_at: '2026-11-24T09:00:00Z',
  updated_at: '2026-11-24T09:00:00Z',
  deleted_at: null,
  ...extra,
})

const week = (extra: Partial<StudentWeek> = {}): StudentWeek => ({
  student: summary(),
  settings: null,
  planBlocks: [],
  campaigns: [campaign],
  accounts: [account],
  videos: [],
  videoPosts: [],
  earnings: [],
  ideateNotes: [ownNote],
  coachNotes: [coachRow()],
  trybeVideos: 0,
  posts: {
    connected: true,
    reading: 0,
    posts: [post('best', { views: 9000, publishedAt: at(24, 9) }), post('worst', { views: 100, publishedAt: at(22, 9) })],
  },
  ...extra,
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  listStudents.mockReset()
  loadStudent.mockReset()
  saveCoachNote.mockReset()
  deleteCoachNote.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** A student's page opens on all their campaigns; the notes live on one. */
async function openVertus(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('tab', { name: /^Vertus/ }))
  await screen.findByRole('group', { name: 'Vertus figures' })
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<p>Home screen</p>} />
        <Route path="/coach" element={<Coach />} />
        <Route path="/coach/:studentId" element={<CoachStudent />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('/coach', () => {
  it('shows a student nothing but a line and the way home', async () => {
    listStudents.mockResolvedValue(null)
    renderAt('/coach')
    expect(await screen.findByText('Only the coach can open this.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/')
    expect(screen.queryByText('Students')).toBeNull()
  })

  it('lists his students, each opening their page', async () => {
    listStudents.mockResolvedValue([
      summary(),
      summary({ id: 'student-2', name: null, email: 'kai@example.com', goal: null, postizConnected: false, lastActiveAt: null }),
    ])
    renderAt('/coach')

    const sam = await screen.findByRole('link', { name: /Sam Rivera/ })
    expect(sam).toHaveAttribute('href', `/coach/${STUDENT}`)
    expect(within(sam).getByText('$2k a month from UGC')).toBeInTheDocument()
    expect(within(sam).getByText('Active 3h ago')).toBeInTheDocument()
    expect(within(sam).getByText('Postiz')).toBeInTheDocument()

    const kai = screen.getByRole('link', { name: /kai@example\.com/ })
    expect(within(kai).getByText('No Postiz')).toBeInTheDocument()
    expect(within(kai).getByText('Not active yet')).toBeInTheDocument()
  })

  it('says so plainly when offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderAt('/coach')
    expect(await screen.findByText('Offline. The coach view needs a connection.')).toBeInTheDocument()
    expect(listStudents).not.toHaveBeenCalled()
  })
})

describe('/coach/:studentId', () => {
  it("reads the student's week and shows their campaign the way IDEATE does", async () => {
    loadStudent.mockResolvedValue(week())
    renderAt(`/coach/${STUDENT}`)

    expect(await screen.findByRole('heading', { name: 'Sam Rivera' })).toBeInTheDocument()
    expect(loadStudent).toHaveBeenCalledWith(STUDENT, { from: new Date(2026, 10, 22).toISOString(), to: new Date(2026, 10, 29).toISOString() })
    // All of their campaigns first, the way IDEATE opens.
    expect(screen.getByRole('tab', { name: /^All campaigns/ })).toHaveAttribute('aria-selected', 'true')
    expect(within(screen.getByRole('group', { name: 'Overview' })).getByLabelText('Videos out')).toHaveTextContent('2')

    const user = userEvent.setup()
    await openVertus(user)
    expect(screen.getByRole('tab', { name: /^Vertus/ })).toHaveAttribute('aria-selected', 'true')
    const figures = screen.getByRole('group', { name: 'Vertus figures' })
    expect(within(figures).getByLabelText('Videos out')).toHaveTextContent('2')
    expect(within(figures).getByLabelText('Average views')).toHaveTextContent('4,550')
    const working = screen.getByRole('region', { name: "What's working" })
    expect(within(working).getByRole('link', { name: /^TikTok, Tue, Nov 24, 9,000 views/ })).toHaveAttribute(
      'href',
      'https://www.tiktok.com/@sam.ugc/video/best',
    )
  })

  it("lets him write Ziad's notes, and keeps the student's own notes read only", async () => {
    loadStudent.mockResolvedValue(week())
    const user = userEvent.setup()
    renderAt(`/coach/${STUDENT}`)
    await openVertus(user)

    const theirs = await screen.findByRole('region', { name: "Sam's notes" })
    expect(within(theirs).getByText('Try a green screen')).toBeInTheDocument()
    expect(within(theirs).queryByRole('textbox')).toBeNull()
    expect(within(theirs).queryByRole('button', { name: /edit|delete|save/i })).toBeNull()

    const his = screen.getByRole('region', { name: 'Notes from Ziad' })
    expect(within(his).getByText('Cut the first two seconds')).toBeInTheDocument()
    expect(within(his).getByRole('textbox', { name: 'Notes from Ziad' })).toBeInTheDocument()
  })

  it('saves a note about the best video with its link, through the coach function', async () => {
    loadStudent.mockResolvedValue(week({ coachNotes: [] }))
    saveCoachNote.mockImplementation(async (input: Record<string, unknown>) =>
      coachRow({ id: 'cn-new', body: input.body as string, post_id: input.post_id as string, post_url: input.post_url as string, created_at: '2026-11-24T20:00:00Z' }),
    )
    const user = userEvent.setup()
    renderAt(`/coach/${STUDENT}`)
    await openVertus(user)

    await user.click(screen.getByRole('button', { name: 'Note on this video: TikTok, Tue, Nov 24, 9,000 views' }))
    const his = screen.getByRole('region', { name: 'Notes from Ziad' })
    expect(within(his).getByText('TikTok, Tue, Nov 24')).toBeInTheDocument()
    await user.type(within(his).getByRole('textbox', { name: 'Notes from Ziad' }), 'More of this')
    await user.click(within(his).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(saveCoachNote).toHaveBeenCalledWith({
        studentId: STUDENT,
        id: undefined,
        campaign_id: 'c1',
        post_id: 'best',
        post_url: 'https://www.tiktok.com/@sam.ugc/video/best',
        week_start: '2026-11-22',
        body: 'More of this',
      }),
    )
    expect(await within(his).findByText('More of this')).toBeInTheDocument()
    expect(within(his).getByRole('link', { name: 'The video ↗' })).toHaveAttribute('href', 'https://www.tiktok.com/@sam.ugc/video/best')
  })

  it('deletes one of his notes', async () => {
    loadStudent.mockResolvedValue(week())
    const user = userEvent.setup()
    renderAt(`/coach/${STUDENT}`)
    await openVertus(user)

    const his = await screen.findByRole('region', { name: 'Notes from Ziad' })
    await user.click(within(his).getByRole('button', { name: 'Delete' }))
    await user.click(within(his).getByRole('button', { name: 'Tap again to delete' }))
    await waitFor(() => expect(deleteCoachNote).toHaveBeenCalledWith('cn1'))
    await waitFor(() => expect(within(his).queryByText('Cut the first two seconds')).toBeNull())
  })

  it('keeps the note and says why when the save fails', async () => {
    loadStudent.mockResolvedValue(week({ coachNotes: [] }))
    saveCoachNote.mockRejectedValue(new Error('Network down'))
    const user = userEvent.setup()
    renderAt(`/coach/${STUDENT}`)
    await openVertus(user)

    const his = await screen.findByRole('region', { name: 'Notes from Ziad' })
    const box = within(his).getByRole('textbox', { name: 'Notes from Ziad' })
    await user.type(box, 'Keep me')
    await user.click(within(his).getByRole('button', { name: 'Save' }))
    expect(await within(his).findByText('Not saved: Network down')).toBeInTheDocument()
    expect(box).toHaveValue('Keep me')
  })

  it("says when the student hasn't added a Postiz key, without sending him to his own Setup", async () => {
    loadStudent.mockResolvedValue(week({ posts: { connected: false, posts: [], reading: 0 } }))
    renderAt(`/coach/${STUDENT}`)
    expect(await screen.findByText('No Postiz key saved yet.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Postiz key/ })).toBeNull()
  })

  it('shows nobody but the coach a student', async () => {
    loadStudent.mockRejectedValue(new Error('Only the coach can open a student.'))
    renderAt(`/coach/${STUDENT}`)
    expect(await screen.findByText('Only the coach can open a student.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument()
  })

  it('says so plainly when offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderAt(`/coach/${STUDENT}`)
    expect(await screen.findByText('Offline. The coach view needs a connection.')).toBeInTheDocument()
    expect(loadStudent).not.toHaveBeenCalled()
  })
})
