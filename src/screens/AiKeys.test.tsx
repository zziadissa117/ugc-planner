import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AiError } from '../ai/errors'
import { AI_PROVIDERS } from '../ai/keys'
import { AiKeys, PostizKey } from './AiKeys'

const listKeys = vi.fn()
const saveKey = vi.fn()
const removeKey = vi.fn()
let auth = { configured: true, email: 'me@example.com' as string | null }

vi.mock('../ai/keys', async () => {
  const real = await vi.importActual<typeof import('../ai/keys')>('../ai/keys')
  return { ...real, listKeys: () => listKeys(), saveKey: (p: string, k: string) => saveKey(p, k), removeKey: (p: string) => removeKey(p) }
})
vi.mock('../sync', () => ({ useAuth: () => auth }))

const FULL_KEY = 'sk-ant-api03-SECRETSECRETSECRET1234'

beforeEach(() => {
  auth = { configured: true, email: 'me@example.com' }
  listKeys.mockReset().mockResolvedValue([])
  saveKey.mockReset()
  removeKey.mockReset().mockResolvedValue(undefined)
})

describe('AiKeys', () => {
  it('renders nothing when sign-in is not configured', () => {
    auth = { configured: false, email: null }
    const { container } = render(<AiKeys />)
    expect(container).toBeEmptyDOMElement()
  })

  it('asks him to sign in first when signed out', () => {
    auth = { configured: true, email: null }
    render(<AiKeys />)
    expect(screen.getByText(/sign in above/i)).toBeInTheDocument()
    expect(listKeys).not.toHaveBeenCalled()
  })

  it('shows only the last four characters of a saved key, never the key', async () => {
    listKeys.mockResolvedValue([{ provider: 'anthropic', last4: '1234', updated_at: '2026-10-02T00:00:00Z' }])
    const { container } = render(<AiKeys />)
    expect(await screen.findByText(/1234/)).toBeInTheDocument()
    expect(container.textContent).not.toContain('sk-ant')
    expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/api key/i)).toBeNull()
  })

  it('saves a pasted key, masks it, and empties the box', async () => {
    saveKey.mockResolvedValue({ provider: 'anthropic', last4: '1234', updated_at: '2026-10-02T00:00:00Z' })
    const user = userEvent.setup()
    const { container } = render(<AiKeys />)

    const box = await screen.findByLabelText(/anthropic api key/i)
    expect(box).toHaveAttribute('type', 'password')
    await user.type(box, FULL_KEY)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(saveKey).toHaveBeenCalledWith('anthropic', FULL_KEY)
    expect(await screen.findByText(/1234/)).toBeInTheDocument()
    expect(container.textContent).not.toContain('SECRET')
    expect(screen.queryByLabelText(/api key/i)).toBeNull()
  })

  it('shows the server\'s reason when the key is rejected, and keeps the box', async () => {
    saveKey.mockRejectedValue(new AiError('Your saved API key was rejected. Paste a working one in Setup.', 'invalid_key'))
    const user = userEvent.setup()
    render(<AiKeys />)

    await user.type(await screen.findByLabelText(/anthropic api key/i), FULL_KEY)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/was rejected/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/anthropic api key/i)).toBeInTheDocument()
  })

  it('removes a saved key', async () => {
    listKeys.mockResolvedValue([{ provider: 'anthropic', last4: '1234', updated_at: '2026-10-02T00:00:00Z' }])
    const user = userEvent.setup()
    render(<AiKeys />)

    await user.click(await screen.findByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(removeKey).toHaveBeenCalledWith('anthropic'))
    expect(await screen.findByText(/no key saved/i)).toBeInTheDocument()
  })

  it('says so when the saved keys cannot be loaded', async () => {
    listKeys.mockRejectedValue(new AiError('Invalid or expired session.'))
    render(<AiKeys />)
    expect(await screen.findByText(/invalid or expired session/i)).toBeInTheDocument()
  })
})

describe('PostizKey', () => {
  const POSTIZ_KEY = 'pz_live_SECRETSECRET9876'

  it('is not offered as an AI key', async () => {
    expect(AI_PROVIDERS.map((p) => p.id)).not.toContain('postiz')
    render(<AiKeys />)
    await screen.findByLabelText(/anthropic api key/i)
    expect(screen.queryByLabelText(/postiz/i)).toBeNull()
  })

  it('says what it is for, and asks to sign in first when signed out', () => {
    auth = { configured: true, email: null }
    render(<PostizKey />)
    expect(screen.getByText(/sign in above to add your postiz key/i)).toBeInTheDocument()
    expect(listKeys).not.toHaveBeenCalled()
  })

  it('saves a pasted Postiz key, shows only its last four, and empties the box', async () => {
    saveKey.mockResolvedValue({ provider: 'postiz', last4: '9876', updated_at: '2026-11-24T00:00:00Z' })
    const user = userEvent.setup()
    const { container } = render(<PostizKey />)

    expect(screen.getByText('So IDEATE can show your videos and their views.')).toBeInTheDocument()
    const box = await screen.findByLabelText('Postiz API key')
    expect(box).toHaveAttribute('type', 'password')
    await user.type(box, POSTIZ_KEY)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(saveKey).toHaveBeenCalledWith('postiz', POSTIZ_KEY)
    expect(await screen.findByText(/9876/)).toBeInTheDocument()
    expect(container.textContent).not.toContain('SECRET')
    expect(screen.queryByLabelText('Postiz API key')).toBeNull()
  })

  it('shows a saved Postiz key masked, and removes it', async () => {
    listKeys.mockResolvedValue([
      { provider: 'anthropic', last4: '1234', updated_at: '2026-10-02T00:00:00Z' },
      { provider: 'postiz', last4: '9876', updated_at: '2026-11-24T00:00:00Z' },
    ])
    const user = userEvent.setup()
    render(<PostizKey />)

    expect(await screen.findByText(/9876/)).toBeInTheDocument()
    expect(screen.queryByText(/1234/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(removeKey).toHaveBeenCalledWith('postiz'))
    expect(await screen.findByText(/no key saved/i)).toBeInTheDocument()
  })
})
