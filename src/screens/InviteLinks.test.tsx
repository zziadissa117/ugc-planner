import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { InviteLink } from '../sync/invites'
import { InviteLinks } from './InviteLinks'
import { Join } from './Join'

const listInvites = vi.fn()
const createInvite = vi.fn()
const switchOffInvite = vi.fn()
const requestLink = vi.fn()
let auth = {
  configured: true,
  email: 'me@example.com' as string | null,
  requestStatus: 'idle' as 'idle' | 'sending' | 'sent' | 'error',
  requestError: null as string | null,
  requestLink: (email: string, code?: string) => requestLink(email, code),
}

vi.mock('../sync/invites', async () => {
  const real = await vi.importActual<typeof import('../sync/invites')>('../sync/invites')
  return {
    ...real,
    listInvites: () => listInvites(),
    createInvite: (n: number) => createInvite(n),
    switchOffInvite: (id: string) => switchOffInvite(id),
  }
})
const inviteStatus = vi.fn()
vi.mock('../sync', async () => {
  const { INVITE_REFUSALS } = await vi.importActual<typeof import('../sync/auth')>('../sync/auth')
  return { useAuth: () => auth, inviteStatus: (code: string) => inviteStatus(code), INVITE_REFUSALS }
})

function link(overrides: Partial<InviteLink> = {}): InviteLink {
  return {
    id: 'link-1',
    code: 'abcDEF123456ghiJKL',
    max_uses: 10,
    created_at: '2026-10-29T00:00:00Z',
    switched_off_at: null,
    joined: [],
    ...overrides,
  }
}

beforeEach(() => {
  auth = { ...auth, configured: true, email: 'me@example.com', requestStatus: 'idle', requestError: null }
  listInvites.mockReset().mockResolvedValue([])
  createInvite.mockReset()
  switchOffInvite.mockReset()
  requestLink.mockReset().mockResolvedValue(undefined)
  inviteStatus.mockReset().mockResolvedValue('open')
})

describe('InviteLinks', () => {
  it('shows nothing to anyone the server does not treat as the owner', async () => {
    listInvites.mockResolvedValue(null)
    const { container } = render(<InviteLinks />)
    await vi.waitFor(() => expect(listInvites).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('shows nothing and asks nothing while signed out', () => {
    auth = { ...auth, email: null }
    const { container } = render(<InviteLinks />)
    expect(container).toBeEmptyDOMElement()
    expect(listInvites).not.toHaveBeenCalled()
  })

  it('makes a link for ten by default and shows its address', async () => {
    createInvite.mockResolvedValue(link())
    const user = userEvent.setup()
    render(<InviteLinks />)

    await user.click(await screen.findByRole('button', { name: /new link/i }))
    expect(createInvite).toHaveBeenCalledWith(10)
    expect(await screen.findByText(/\/join\/abcDEF123456ghiJKL$/)).toBeInTheDocument()
    expect(screen.getByText('0 of 10 joined')).toBeInTheDocument()
  })

  it('lists who joined, and a full link offers no copy', async () => {
    listInvites.mockResolvedValue([
      link({
        max_uses: 2,
        joined: [
          { email: 'a@example.com', joined_at: '2026-10-29T01:00:00Z' },
          { email: 'b@example.com', joined_at: '2026-10-29T02:00:00Z' },
        ],
      }),
    ])
    render(<InviteLinks />)
    expect(await screen.findByText('2 of 2 joined')).toBeInTheDocument()
    expect(screen.getByText('full')).toBeInTheDocument()
    expect(screen.getByText('a@example.com')).toBeInTheDocument()
    expect(screen.getByText('b@example.com')).toBeInTheDocument()
  })

  it('switches a link off and hides its address', async () => {
    listInvites.mockResolvedValue([link()])
    switchOffInvite.mockResolvedValue(link({ switched_off_at: '2026-10-29T03:00:00Z' }))
    const user = userEvent.setup()
    render(<InviteLinks />)

    await user.click(await screen.findByRole('button', { name: 'Switch off' }))
    expect(switchOffInvite).toHaveBeenCalledWith('link-1')
    expect(await screen.findByText('switched off')).toBeInTheDocument()
    expect(screen.queryByText(/\/join\//)).toBeNull()
  })
})

describe('Join', () => {
  function renderJoin() {
    return render(
      <MemoryRouter initialEntries={['/join/abcDEF123456ghiJKL']}>
        <Routes>
          <Route path="/join/:code" element={<Join />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('sends the code from the link along with the email', async () => {
    auth = { ...auth, email: null }
    const user = userEvent.setup()
    renderJoin()
    await user.type(screen.getByLabelText('Email'), ' student@example.com ')
    await user.click(screen.getByRole('button', { name: 'Send link' }))
    expect(requestLink).toHaveBeenCalledWith('student@example.com', 'abcDEF123456ghiJKL')
  })

  it('says a full link is full before asking for an email', async () => {
    auth = { ...auth, email: null }
    inviteStatus.mockResolvedValue('full')
    renderJoin()
    expect(await screen.findByText(/This invite link is full\./)).toBeInTheDocument()
    expect(inviteStatus).toHaveBeenCalledWith('abcDEF123456ghiJKL')
    expect(screen.queryByLabelText('Email')).toBeNull()
  })

  it('still offers the email box when the link cannot be checked', async () => {
    auth = { ...auth, email: null }
    inviteStatus.mockRejectedValue(new Error('offline'))
    renderJoin()
    await vi.waitFor(() => expect(inviteStatus).toHaveBeenCalled())
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it("shows the server's refusal as it comes", () => {
    auth = { ...auth, email: null, requestStatus: 'error', requestError: 'This invite link is full.' }
    renderJoin()
    expect(screen.getByText('This invite link is full.')).toBeInTheDocument()
  })

  it('does not ask someone already signed in to join', () => {
    renderJoin()
    expect(screen.getByText(/signed in as/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Email')).toBeNull()
  })
})
