// Sign-in is the only place src/sync/auth.ts is ever actually called from a
// screen (see AuthProvider.tsx) - this is what makes account creation
// possible at all, and therefore what makes the AI parser (which requires a
// session) reachable in a running app rather than only in tests.

import 'fake-indexeddb/auto'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataAdapter } from '../data'
import { DataContext } from '../data/context'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { AuthProvider } from '../sync/AuthProvider'
import { Settings } from './Settings'

// AuthProvider calls signIn/signOut/getSupabaseClient directly by name (see
// AuthProvider.tsx), so mocking only getSupabaseClient and keeping the real
// signIn/signOut would not work - their own internal calls close over the
// real module's getSupabaseClient, not this test's override. All three are
// mocked instead, the same way NewCampaign.test.tsx mocks the whole module.
const signIn = vi.fn()
const signOutFn = vi.fn()
const getSession = vi.fn()
const onAuthStateChange = vi.fn()
let mockClient: unknown = null

vi.mock('../sync/auth', () => ({
  getSupabaseClient: () => mockClient,
  signIn: (email: string) => signIn(email),
  signOut: () => signOutFn(),
}))

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: DataAdapter

beforeEach(async () => {
  localStorage.clear()
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`settings-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()

  mockClient = null
  signIn.mockReset().mockResolvedValue(undefined)
  signOutFn.mockReset().mockResolvedValue(undefined)
  getSession.mockReset().mockResolvedValue({ data: { session: null } })
  onAuthStateChange.mockReset().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
})

function fakeClient() {
  return {
    auth: { getSession, onAuthStateChange },
  }
}

function renderSettings() {
  render(
    <DataContext.Provider value={adapter}>
      <MemoryRouter>
        <AuthProvider>
          <Settings />
        </AuthProvider>
      </MemoryRouter>
    </DataContext.Provider>,
  )
}

describe('the account section', () => {
  it('renders nothing when Supabase is not configured', async () => {
    mockClient = null
    renderSettings()
    expect(screen.queryByText(/sign in/i)).toBeNull()
  })

  it('offers a magic-link sign-in when configured and signed out', async () => {
    mockClient = fakeClient()
    const user = userEvent.setup()
    renderSettings()

    const emailField = await screen.findByPlaceholderText('you@example.com')
    await user.type(emailField, 'creator@example.com')
    await user.click(screen.getByRole('button', { name: 'Send link' }))

    expect(signIn).toHaveBeenCalledWith('creator@example.com')
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument()
  })

  it('shows the signed-in account and a working sign-out button', async () => {
    mockClient = fakeClient()
    getSession.mockResolvedValue({
      data: { session: { user: { id: USER, email: 'creator@example.com' } } },
    })

    const user = userEvent.setup()
    renderSettings()

    // On the fold, and inside it.
    expect(await screen.findAllByText('creator@example.com')).not.toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(signOutFn).toHaveBeenCalled()
  })
})

describe('the priorities list', () => {
  it('sorts a new line with two questions, importance first, then puts it on Today', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.type(await screen.findByPlaceholderText('e.g. Charge the phone rig'), 'Answer Vertus{Enter}')
    expect(await screen.findByText('Does it move a campaign or money forward?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Answer Vertus: yes' }))
    expect(await screen.findByText('Does it have to happen in the next day or two?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Answer Vertus: yes' }))

    expect(await screen.findByText('Important and soon')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Put Answer Vertus on Today' }))
    expect(await screen.findByText('Do this now')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Mark Answer Vertus done' }))
    expect(await screen.findByText('Done')).toBeInTheDocument()
    expect(screen.queryByText('Do this now')).toBeNull()
  })

  it('asks when for something important that is not urgent', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.type(await screen.findByPlaceholderText('e.g. Charge the phone rig'), 'Plan next month{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Plan next month: yes' }))
    await user.click(await screen.findByRole('button', { name: 'Plan next month: no' }))

    expect(await screen.findByText('Important, not urgent')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add a when for Plan next month' }))
    const when = screen.getByRole('textbox', { name: 'When for Plan next month' })
    await user.type(when, 'Sunday 10am at the desk{Enter}')
    expect(await screen.findByText('Sunday 10am at the desk')).toBeInTheDocument()
  })

  it('carries the old checklist over, waiting to be sorted', async () => {
    localStorage.setItem('ugc-planner.studio-todos', JSON.stringify([{ id: 'a', text: 'Charge the rig', done: false }]))
    renderSettings()

    expect(await screen.findByText('Charge the rig')).toBeInTheDocument()
    expect(screen.getByText('Sort these')).toBeInTheDocument()
  })
})

describe('the priorities list, kept bare', () => {
  it('keeps remove and sort-again behind Edit', async () => {
    const user = userEvent.setup()
    renderSettings()

    await user.type(await screen.findByPlaceholderText('e.g. Charge the phone rig'), 'Charge the rig{Enter}')
    await user.click(await screen.findByRole('button', { name: 'Charge the rig: no' }))
    await user.click(await screen.findByRole('button', { name: 'Charge the rig: yes' }))
    expect(screen.queryByRole('button', { name: 'Remove Charge the rig' })).toBeNull()
    expect(screen.queryByText('Sort again')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(screen.getByRole('button', { name: 'Remove Charge the rig' }))
    expect(screen.queryByText('Charge the rig')).toBeNull()
  })
})

describe("the priorities list's campaign link", () => {
  async function makeCampaign(name: string) {
    return adapter.createCampaign({
      name,
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      daily_post_quota: 1,
      pay_per_video_cents: null,
      cycle_size: null,
    })
  }

  it('shows a button to the brief when a line names a campaign', async () => {
    const campaign = await makeCampaign('Amboras')
    const user = userEvent.setup()
    renderSettings()

    await user.type(
      await screen.findByPlaceholderText('e.g. Charge the phone rig'),
      'Amboras: create account and do this and that{Enter}',
    )

    const link = await screen.findByRole('link', { name: 'Open the brief for Amboras' })
    expect(link).toHaveAttribute('href', `/campaigns/${campaign.id}`)
  })

  it('shows no button on a line that names no campaign', async () => {
    await makeCampaign('Amboras')
    const user = userEvent.setup()
    renderSettings()

    await user.type(
      await screen.findByPlaceholderText('e.g. Charge the phone rig'),
      'Charge the phone rig{Enter}',
    )

    await screen.findByText('Charge the phone rig')
    expect(screen.queryByRole('link', { name: /Open the brief/ })).toBeNull()
  })

  it('picks the longer name when one campaign name sits inside another', async () => {
    await makeCampaign('Inflow')
    const longer = await makeCampaign('Inflow Canada')
    const user = userEvent.setup()
    renderSettings()

    await user.type(
      await screen.findByPlaceholderText('e.g. Charge the phone rig'),
      'Inflow Canada needs a new handle{Enter}',
    )

    const link = await screen.findByRole('link', { name: 'Open the brief for Inflow Canada' })
    expect(link).toHaveAttribute('href', `/campaigns/${longer.id}`)
  })

  it('matches without caring about case', async () => {
    const campaign = await makeCampaign('Amboras')
    const user = userEvent.setup()
    renderSettings()

    await user.type(
      await screen.findByPlaceholderText('e.g. Charge the phone rig'),
      'amboras handle{Enter}',
    )

    expect(await screen.findByRole('link', { name: 'Open the brief for Amboras' })).toHaveAttribute(
      'href',
      `/campaigns/${campaign.id}`,
    )
  })
})
