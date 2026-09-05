// Sign-in is the only place src/sync/auth.ts is ever actually called from a
// screen (see AuthProvider.tsx) - this is what makes account creation
// possible at all, and therefore what makes the AI parser (which requires a
// session) reachable in a running app rather than only in tests.

import 'fake-indexeddb/auto'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
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
      <AuthProvider>
        <Settings />
      </AuthProvider>
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

    expect(await screen.findByText('creator@example.com')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(signOutFn).toHaveBeenCalled()
  })
})
