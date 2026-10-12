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

  it('says when changes on this device have not reached the server, and why one was refused', async () => {
    mockClient = fakeClient()
    getSession.mockResolvedValue({
      data: { session: { user: { id: USER, email: 'creator@example.com' } } },
    })
    const campaign = await adapter.createCampaign({
      name: 'Inflow',
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      pay_per_video_cents: 3500,
      cycle_size: null,
    })
    await adapter.updateCampaign(campaign.id, { name: 'Inflow 2' })
    const [first] = await adapter.listPendingWrites()
    for (let i = 0; i < 5; i++) await adapter.markWriteFailed(first.id, '42501: RLS refused it')

    renderSettings()

    expect(await screen.findByText(/\d+ changes? on this device not on the server yet/)).toBeInTheDocument()
    expect(screen.getByText(/1 change the server refused: 42501: RLS refused it/)).toBeInTheDocument()
  })

  it('says nothing about the queue when everything is on the server', async () => {
    mockClient = fakeClient()
    getSession.mockResolvedValue({
      data: { session: { user: { id: USER, email: 'creator@example.com' } } },
    })
    renderSettings()

    expect(await screen.findAllByText('creator@example.com')).not.toHaveLength(0)
    expect(screen.queryByText(/not on the server yet|the server refused/)).toBeNull()
  })
})
