// When the server stops accepting this device's sign-in while the app still
// looks signed in (2026-10-08: a refused token renewal), the app has to say
// so - silently, nothing synced and the cutter stopped ticking posts.

import 'fake-indexeddb/auto'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { useContext } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SignedOut } from '../App'
import type { DataAdapter } from '../data'
import { DataContext } from '../data/context'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { AuthContext } from './AuthContext'
import { AuthProvider } from './AuthProvider'
import { sessionExpired } from './session'

type Listener = (event: string, session: unknown) => void
let listener: Listener = () => {}
let session: { user: { id: string; email: string }; expires_at: number } | null = null
const signOutFn = vi.fn(async () => {})

vi.mock('./auth', () => ({
  getSupabaseClient: () => ({
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: (callback: Listener) => {
        listener = callback
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
    },
  }),
  signIn: vi.fn(),
  signOut: () => signOutFn(),
}))

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: DataAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`session-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
  session = { user: { id: USER, email: 'me@example.com' }, expires_at: Math.floor(Date.now() / 1000) + 3600 }
  signOutFn.mockClear()
})

function Probe() {
  const auth = useContext(AuthContext)
  return <p>{auth?.sessionLost ? 'lost' : 'fine'}</p>
}

function renderProvider() {
  render(
    <DataContext.Provider value={adapter}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </DataContext.Provider>,
  )
}

describe('noticing a dead sign-in', () => {
  it('reads a token more than a minute past its time as dead, and a fresh one as fine', () => {
    const now = Date.parse('2026-10-08T18:16:00Z')
    expect(sessionExpired(now / 1000 - 120, now)).toBe(true)
    expect(sessionExpired(now / 1000 - 30, now)).toBe(false)
    expect(sessionExpired(now / 1000 + 3600, now)).toBe(false)
    expect(sessionExpired(undefined, now)).toBe(false)
  })

  it('says so when the server signs him out without him asking', async () => {
    renderProvider()
    expect(await screen.findByText('fine')).toBeInTheDocument()
    act(() => listener('SIGNED_OUT', null))
    expect(await screen.findByText('lost')).toBeInTheDocument()
    // A fresh sign-in clears it.
    act(() => listener('SIGNED_IN', session))
    expect(await screen.findByText('fine')).toBeInTheDocument()
  })

  it('says so when the session it holds ran out and could not be renewed', async () => {
    session = { user: { id: USER, email: 'me@example.com' }, expires_at: Math.floor(Date.now() / 1000) - 600 }
    renderProvider()
    expect(await screen.findByText('lost')).toBeInTheDocument()
  })
})

describe('the warning', () => {
  it('names the account, and Sign in again signs out and opens Setup', async () => {
    const user = userEvent.setup()
    const signOut = vi.fn(async () => {})
    render(
      <MemoryRouter initialEntries={['/post']}>
        <Routes>
          <Route path="/post" element={<SignedOut email="me@example.com" onSignIn={signOut} />} />
          <Route path="/settings" element={<p>Setup screen</p>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/Signed out \(me@example.com\) - nothing is syncing/)
    await user.click(screen.getByRole('button', { name: 'Sign in again' }))
    await waitFor(() => expect(screen.getByText('Setup screen')).toBeInTheDocument())
    expect(signOut).toHaveBeenCalled()
  })
})
