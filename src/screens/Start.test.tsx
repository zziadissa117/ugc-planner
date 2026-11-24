import 'fake-indexeddb/auto'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { announceDataChanged } from '../data/changed'
import { DataContext } from '../data/context'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { LocalDatabase } from '../data/local/db'
import { AuthContext, type AuthControls } from '../sync/AuthContext'
import { applyDraft, keepInvite, readDraft } from '../sync/onboardingDraft'
import { Start } from './Start'

const sendQuizFinished = vi.fn()
vi.mock('../sync/quizFinished', () => ({ sendQuizFinished: (a: unknown) => sendQuizFinished(a) }))

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: LocalAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  localStorage.clear()
  sendQuizFinished.mockReset()
  const db = new LocalDatabase(`start-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})

const requestLink = vi.fn()
function signedOut(overrides: Partial<AuthControls> = {}): AuthControls {
  return {
    configured: true,
    ready: true,
    email: null,
    settingUp: false,
    sessionLost: false,
    requestStatus: 'idle',
    requestError: null,
    requestLink: (...args) => requestLink(...args),
    signOut: async () => undefined,
    ...overrides,
  }
}

function renderQuiz(auth: AuthControls | null = null) {
  const tree = (
    <DataContext.Provider value={adapter}>
      <MemoryRouter initialEntries={['/start']}>
        <Routes>
          <Route path="/start" element={<Start />} />
          <Route path="/" element={<p>home</p>} />
        </Routes>
      </MemoryRouter>
    </DataContext.Provider>
  )
  return render(auth ? <AuthContext.Provider value={auth}>{tree}</AuthContext.Provider> : tree)
}

/** Welcome to the review: 2 hours, Mon/Wed/Fri at 6 pm, ideate Saturday. */
async function answerQuiz(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: "Let's set it up" }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  for (const slot of ['Mon 6:00 pm', 'Wed 6:00 pm', 'Fri 6:00 pm', 'Sat 10:00 am']) await user.click(screen.getByRole('button', { name: slot }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.type(screen.getByLabelText("What's your name?"), 'Sam')
  await user.type(screen.getByLabelText("What's your goal?"), 'First campaign')
  await user.click(screen.getByRole('button', { name: 'Next' }))
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

    await user.type(screen.getByLabelText("What's your name?"), 'Sam')
    await user.type(screen.getByLabelText("What's your goal?"), 'First campaign')
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

  it('starts the week on Sunday', async () => {
    const user = userEvent.setup()
    renderQuiz()
    await user.click(await screen.findByRole('button', { name: "Let's set it up" }))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getAllByRole('button', { name: /^\w{3} 6:00 am$/ }).map((b) => b.getAttribute('aria-label'))).toEqual(
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `${d} 6:00 am`),
    )
  })

  describe('signed out', () => {
    beforeEach(() => requestLink.mockReset().mockResolvedValue(undefined))

    it('makes the account at the end, carrying the invite and the week, and saves nothing until it exists', async () => {
      keepInvite('invite-code-123')
      const user = userEvent.setup()
      renderQuiz(signedOut())
      // No sign-in button over the quiz - the account is its last step.
      expect(await screen.findByRole('button', { name: "Let's set it up" })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull()
      await answerQuiz(user)
      expect(screen.getByRole('list', { name: 'Step 4 of 5' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Looks good' }))

      expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument()
      await user.type(screen.getByLabelText('Your email'), 'sam@example.com')
      await user.click(screen.getByRole('button', { name: 'Create my account' }))
      expect(requestLink).toHaveBeenCalledWith(
        'sam@example.com',
        'invite-code-123',
        expect.objectContaining({ student_name: 'Sam', goal: 'First campaign', minutes_per_day: 120, blocks: expect.any(Array) }),
      )
      expect(readDraft()?.blocks).toHaveLength(4)
      expect(await adapter.listPlanBlocks()).toEqual([])
      expect(sendQuizFinished).not.toHaveBeenCalled()
    })

    it('says it is waiting, then opens the planner once the week is saved to the account', async () => {
      await adapter.updateUserSettings({})
      renderQuiz(signedOut({ email: 'sam@example.com', settingUp: true }))
      expect(await screen.findByText('Setting up your planner')).toBeInTheDocument()
      await act(async () => {
        await applyDraft(adapter, {
          blocks: [{ kind: 'record', weekday: 0, start_minute: 1080, duration_minutes: 120 }],
          student_name: 'Sam',
          timezone: 'America/Toronto',
          goal: 'First campaign',
          wish: null,
          minutes_per_day: 120,
        })
        announceDataChanged()
      })
      expect(await screen.findByText('home')).toBeInTheDocument()
    })

    it('lets someone with an account sign in from the welcome instead of starting over', async () => {
      const user = userEvent.setup()
      renderQuiz(signedOut())
      await user.click(await screen.findByRole('button', { name: 'Sign in' }))
      expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
      await user.type(screen.getByLabelText('Your email'), 'me@example.com')
      await user.click(screen.getByRole('button', { name: 'Send me a link' }))
      expect(requestLink).toHaveBeenCalledWith('me@example.com', undefined, undefined)
    })

    it("shows the server's refusal as it comes", async () => {
      const user = userEvent.setup()
      renderQuiz(signedOut({ requestStatus: 'error', requestError: 'This invite link is full.' }))
      await user.click(await screen.findByRole('button', { name: 'Sign in' }))
      expect(screen.getByText('This invite link is full.')).toBeInTheDocument()
    })

    it('says to check the email once the link is sent', async () => {
      const user = userEvent.setup()
      renderQuiz(signedOut({ requestStatus: 'sent' }))
      await user.click(await screen.findByRole('button', { name: 'Sign in' }))
      expect(screen.getByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
    })
  })

  it('lets someone signed in change their week without being sent away', async () => {
    await adapter.replacePlanBlocks([{ kind: 'record', weekday: 0, start_minute: 1080, duration_minutes: 120 }])
    const user = userEvent.setup()
    renderQuiz(signedOut({ email: 'me@example.com' }))
    await user.click(await screen.findByRole('button', { name: 'Change my week' }))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByText('home')).toBeNull()
    expect(screen.getByRole('heading', { name: 'How long is each recording day?' })).toBeInTheDocument()
  })

  it('has no account step for someone already signed in', async () => {
    const user = userEvent.setup()
    renderQuiz(signedOut({ email: 'me@example.com' }))
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
    await answerQuiz(user)
    expect(screen.getByRole('list', { name: 'Step 4 of 4' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Looks good' }))
    expect(await screen.findByText('home')).toBeInTheDocument()
    expect(await adapter.listPlanBlocks()).toHaveLength(4)
  })
})
