// A screen that throws shows one plain sentence and a way out, not the
// router's developer page.

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'

import { ScreenError } from './ScreenError'

function Broken(): never {
  throw new TypeError("undefined is not an object (evaluating 'e.toLocaleString')")
}

describe('ScreenError', () => {
  beforeEach(() => {
    // React and the router both report the caught error; that noise is the
    // point of the test, not a failure of it.
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('says what happened in plain words and offers a reload', () => {
    const router = createMemoryRouter(
      [{ path: '/post', element: <Broken />, errorElement: <ScreenError /> }],
      { initialEntries: ['/post'] },
    )
    render(<RouterProvider router={router} />)
    expect(screen.getByRole('alert')).toHaveTextContent('This screen hit a problem')
    expect(screen.getByText(/Nothing you saved is lost/)).toBeInTheDocument()
    // Once as the line he can screenshot, once more inside the folded details.
    expect(screen.getAllByText(/undefined is not an object/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back to NOW/ })).toHaveAttribute('href', '/')
    expect(screen.queryByText(/Unexpected Application Error/)).not.toBeInTheDocument()
  })
})
