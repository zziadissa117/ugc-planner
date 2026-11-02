import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthContext, type AuthControls } from './AuthContext'

const listInvites = vi.fn()
vi.mock('./invites', () => ({ listInvites: () => listInvites() }))

const { useIsOwner } = await import('./owner')

function Probe() {
  return <p>{useIsOwner() ? 'owner' : 'not owner'}</p>
}

function renderAs(email: string | null) {
  const auth = { email } as AuthControls
  return render(
    <AuthContext.Provider value={auth}>
      <Probe />
    </AuthContext.Provider>,
  )
}

beforeEach(() => {
  listInvites.mockReset()
  localStorage.clear()
})

describe('useIsOwner', () => {
  it('is the owner when the server lists his invite links', async () => {
    listInvites.mockResolvedValue([])
    renderAs('him@example.com')
    expect(await screen.findByText('owner')).toBeInTheDocument()
  })

  it('is not, for a student the server answers enabled: false', async () => {
    listInvites.mockResolvedValue(null)
    renderAs('student@example.com')
    await waitFor(() => expect(listInvites).toHaveBeenCalled())
    expect(screen.getByText('not owner')).toBeInTheDocument()
  })

  it('remembers the answer offline, for the same email only', async () => {
    listInvites.mockResolvedValue([])
    const first = renderAs('him@example.com')
    await screen.findByText('owner')
    first.unmount()

    listInvites.mockRejectedValue(new Error('offline'))
    const offline = renderAs('him@example.com')
    expect(screen.getByText('owner')).toBeInTheDocument()
    offline.unmount()

    renderAs('someone@example.com')
    expect(screen.getByText('not owner')).toBeInTheDocument()
  })

  it('is never the owner signed out', () => {
    renderAs(null)
    expect(screen.getByText('not owner')).toBeInTheDocument()
    expect(listInvites).not.toHaveBeenCalled()
  })
})
