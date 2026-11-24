import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import type { DraftBlock } from '../data/weeklyPlan'
import { WeekCalendar } from './WeekCalendar'

const monday: DraftBlock = { kind: 'record', weekday: 0, start_minute: 18 * 60, duration_minutes: 120 }

function Harness({ initial }: { initial: DraftBlock[] }) {
  const [blocks, setBlocks] = useState(initial)
  return (
    <>
      <WeekCalendar blocks={blocks} minutesPerDay={120} onChange={setBlocks} />
      <pre data-testid="week">{JSON.stringify(blocks.map((b) => [b.kind, b.weekday, b.start_minute]))}</pre>
    </>
  )
}

const week = () => JSON.parse(screen.getByTestId('week').textContent ?? '[]') as [string, number, number][]
const block = () => screen.getByRole('button', { name: /^Mon 6:\d\d pm Record|^Mon \d+:\d\d (am|pm) Record/ })

describe('the week calendar', () => {
  it('moves a block along its day: tap it, then tap the new time', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[monday]} />)
    await user.click(block())
    expect(screen.getByText(/drag it, or tap a new time on Monday/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mon 8:00 pm' }))
    expect(week()).toEqual([['record', 0, 20 * 60]])
  })

  it('keeps a block on its own day', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[monday]} />)
    await user.click(block())
    await user.click(screen.getByRole('button', { name: 'Tue 6:00 pm' }))
    expect(screen.getByRole('status')).toHaveTextContent('A block moves along its own day')
    expect(week()).toEqual([['record', 0, 18 * 60]])
  })

  it('drags a block to a new time, by the quarter hour', () => {
    render(<Harness initial={[monday]} />)
    const target = block()
    // 26px a half hour: 52px down is an hour later.
    fireEvent.pointerDown(target, { pointerId: 1, button: 0, clientY: 300 })
    fireEvent.pointerMove(target, { pointerId: 1, clientY: 320 })
    fireEvent.pointerMove(target, { pointerId: 1, clientY: 352 })
    fireEvent.pointerUp(target, { pointerId: 1, clientY: 352 })
    expect(week()).toEqual([['record', 0, 19 * 60]])
  })

  it('will not drop a block onto another one, and says why', () => {
    const ideate: DraftBlock = { kind: 'ideate', weekday: 1, start_minute: 10 * 60, duration_minutes: 60 }
    const later: DraftBlock = { ...ideate, start_minute: 12 * 60 }
    render(<Harness initial={[ideate, later]} />)
    const first = screen.getByRole('button', { name: /^Tue 10:00 am Ideate/ })
    fireEvent.pointerDown(first, { pointerId: 1, button: 0, clientY: 100 })
    fireEvent.pointerMove(first, { pointerId: 1, clientY: 204 })
    fireEvent.pointerUp(first, { pointerId: 1, clientY: 204 })
    expect(screen.getByRole('status')).toHaveTextContent('Something is already there.')
    expect(week()).toEqual([
      ['ideate', 1, 600],
      ['ideate', 1, 720],
    ])
  })

  it('moves with the arrow keys and removes with Delete', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[monday]} />)
    block().focus()
    await user.keyboard('{ArrowDown}')
    expect(week()).toEqual([['record', 0, 18 * 60 + 15]])
    await user.keyboard('{Delete}')
    expect(week()).toEqual([])
  })

  it('removes a tapped block with Remove', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[monday]} />)
    await user.click(block())
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(week()).toEqual([])
  })

  it('will not put ideating on a recording day', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[monday]} />)
    await user.click(screen.getByRole('button', { name: 'Ideate' }))
    await user.click(screen.getByRole('button', { name: 'Mon 10:00 am' }))
    expect(screen.getByRole('status')).toHaveTextContent("That's a recording day")
    await user.click(screen.getByRole('button', { name: 'Tue 10:00 am' }))
    expect(week()).toEqual([
      ['record', 0, 1080],
      ['ideate', 1, 600],
    ])
    expect(screen.getByText('1h · 2–4h recommended')).toBeInTheDocument()
  })
})
