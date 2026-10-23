// A screen reads again when rows change behind it - the cutter bridge
// ticking a box, a pull bringing another device's edit.

import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { announceDataChanged } from './changed'
import { useLoaded } from './useLoaded'

let reads = 0

function Reader() {
  const [value] = useLoaded(async () => {
    reads += 1
    return `read ${reads}`
  }, [])
  return <p>{value ?? 'loading'}</p>
}

describe('useLoaded', () => {
  it('reloads when a change is announced', async () => {
    reads = 0
    render(<Reader />)
    expect(await screen.findByText('read 1')).toBeInTheDocument()
    await act(async () => {
      announceDataChanged()
    })
    expect(await screen.findByText('read 2')).toBeInTheDocument()
  })
})
