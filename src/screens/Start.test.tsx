import 'fake-indexeddb/auto'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { DataContext } from '../data/context'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { LocalDatabase } from '../data/local/db'
import { Start } from './Start'

const sendQuizFinished = vi.fn()
vi.mock('../sync/quizFinished', () => ({ sendQuizFinished: (a: unknown) => sendQuizFinished(a) }))

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: LocalAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  sendQuizFinished.mockReset()
  const db = new LocalDatabase(`start-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})

function renderQuiz() {
  return render(
    <DataContext.Provider value={adapter}>
      <MemoryRouter initialEntries={['/start']}>
        <Routes>
          <Route path="/start" element={<Start />} />
          <Route path="/" element={<p>home</p>} />
        </Routes>
      </MemoryRouter>
    </DataContext.Provider>,
  )
}

describe('the onboarding quiz', () => {
  it('builds a week of three recording days and an ideate day, saves it and tells the owner', async () => {
    const user = userEvent.setup()
    renderQuiz()

    await user.click(await screen.findByRole('button', { name: "Let's set it up" }))
    // 2 hours is chosen to start with: the recommendation.
    expect(screen.getByRole('radio', { name: /2 hours · recommended/ })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    const next = screen.getByRole('button', { name: 'Next' })
    expect(next).toBeDisabled()
    for (const slot of ['Mon 6:00 pm', 'Wed 6:00 pm', 'Fri 6:00 pm']) await user.click(screen.getByRole('button', { name: slot }))
    // Three placed: it moves on to ideate days by itself.
    expect(screen.getByRole('button', { name: 'Ideate' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Sat 10:00 am' }))
    await user.click(screen.getByRole('button', { name: 'Next' }))

    await user.type(screen.getByLabelText('Your name'), 'Sam')
    await user.type(screen.getByLabelText('Your goal'), 'First campaign')
    await user.type(screen.getByLabelText(/one thing we could do/), 'More examples')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByText('Friday · 6:00 pm')).toBeInTheDocument()
    expect(screen.getByText('1h Trybe videos, then 1h Media maxing')).toBeInTheDocument()
    expect(screen.getAllByText('1h Trybe videos, then 1h Base UGC')).toHaveLength(2)
    expect(screen.getByText(/put this in your own Google Calendar/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Looks good' }))

    expect(await screen.findByText('home')).toBeInTheDocument()
    const blocks = await adapter.listPlanBlocks()
    expect(blocks.map((b) => [b.kind, b.weekday, b.start_minute, b.duration_minutes])).toEqual([
      ['record', 0, 1080, 120],
      ['record', 2, 1080, 120],
      ['record', 4, 1080, 120],
      ['ideate', 5, 600, 60],
    ])
    const settings = await adapter.getUserSettings()
    expect([settings.student_name, settings.goal, settings.wish, settings.minutes_per_day]).toEqual(['Sam', 'First campaign', 'More examples', 120])
    expect(settings.onboarded_at).not.toBeNull()
    expect(sendQuizFinished).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sam', minutesPerDay: 120 }))
    // Every write is queued for the server.
    const queued = (await adapter.listPendingWrites()).map((w) => w.table_name)
    expect(queued.filter((t) => t === 'plan_blocks')).toHaveLength(4)
    expect(queued).toContain('user_settings')
  })

  it('refuses a fourth recording day and a second on the same day, and says why', async () => {
    const user = userEvent.setup()
    renderQuiz()
    await user.click(await screen.findByRole('button', { name: "Let's set it up" }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Mon 6:00 pm' }))
    await user.click(screen.getByRole('button', { name: 'Mon 8:00 am' }))
    expect(screen.getByText('One recording session a day.')).toBeInTheDocument()
  })

  it('does not tell the owner again when the week is only edited later', async () => {
    await adapter.replacePlanBlocks([
      { kind: 'record', weekday: 0, start_minute: 1080, duration_minutes: 120 },
      { kind: 'record', weekday: 2, start_minute: 1080, duration_minutes: 120 },
      { kind: 'record', weekday: 4, start_minute: 1080, duration_minutes: 120 },
      { kind: 'ideate', weekday: 5, start_minute: 600, duration_minutes: 60 },
    ])
    await adapter.updateUserSettings({ student_name: 'Sam', goal: 'First campaign', timezone: 'America/Toronto', minutes_per_day: 120, onboarded_at: new Date().toISOString() })
    const user = userEvent.setup()
    renderQuiz()
    expect(await screen.findByText('Change your week')).toBeInTheDocument()
    for (let i = 0; i < 4; i++) await user.click(screen.getAllByRole('button', { name: /^(Change my week|Next)$/ })[0])
    await user.click(await screen.findByRole('button', { name: 'Looks good' }))
    expect(await screen.findByText('home')).toBeInTheDocument()
    expect(sendQuizFinished).not.toHaveBeenCalled()
  })
})
