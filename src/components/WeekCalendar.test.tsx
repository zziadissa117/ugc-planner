import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

describe('the now line', () => {
  // Stored weekdays: 0 = Monday. 24 November 2026 is a Tuesday. Local times.
  const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m)
  const line = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-now-line]')
  const lines = (container: HTMLElement) => container.querySelectorAll('[data-now-line]')
  const scroller = (container: HTMLElement) => container.querySelector<HTMLElement>('.overflow-y-auto')!
  /** Which day's column the line is in, by the time slots beside it. */
  const columnOf = (element: HTMLElement) => within(element.parentElement!).getAllByRole('button')[0].getAttribute('aria-label')?.split(' ')[0]

  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("crosses today's column at the time it is now, and nowhere else", () => {
    vi.setSystemTime(at(24, 18, 30))
    const { container } = render(<WeekCalendar blocks={[monday]} minutesPerDay={120} readOnly />)
    expect(lines(container)).toHaveLength(1)
    // 6 am is 10px down, and each half hour 26px more: 6:30 pm is 25 in.
    expect(line(container)!.style.top).toBe('660px')
    expect(columnOf(line(container)!)).toBe('Tue')
    expect(line(container)).toHaveAttribute('aria-hidden', 'true')
    expect(line(container)!.className).toContain('pointer-events-none')
    expect(screen.getByText('Tue').parentElement).toHaveAttribute('aria-current', 'date')
    expect(screen.getByText('Mon').parentElement).not.toHaveAttribute('aria-current')
  })

  it('is in the editable week too, without getting in the way of a tap', async () => {
    vi.setSystemTime(at(24, 18, 30))
    const { container } = render(<Harness initial={[monday]} />)
    expect(columnOf(line(container)!)).toBe('Tue')
    fireEvent.click(screen.getByRole('button', { name: 'Tue 6:30 pm' }))
    expect(week()).toEqual([
      ['record', 0, 18 * 60],
      ['record', 1, 18 * 60 + 30],
    ])
  })

  it('is off the calendar before 6 am, and comes on at 6', () => {
    vi.setSystemTime(at(24, 5, 30))
    const { container } = render(<WeekCalendar blocks={[monday]} minutesPerDay={120} readOnly />)
    expect(line(container)).toBeNull()
    act(() => {
      vi.advanceTimersByTime(30 * 60_000)
    })
    expect(line(container)!.style.top).toBe('10px')
  })

  it('moves every minute, and is on the next day the next day', () => {
    vi.setSystemTime(at(24, 18, 30))
    const { container } = render(<WeekCalendar blocks={[monday]} minutesPerDay={120} readOnly />)
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(parseFloat(line(container)!.style.top)).toBeCloseTo(660 + 26 / 30)
    act(() => {
      vi.advanceTimersByTime(59 * 60_000)
    })
    expect(line(container)!.style.top).toBe('712px')

    // At 1 am it is gone until 6 am - then on Wednesday, at 6:30.
    act(() => {
      vi.advanceTimersByTime((5 * 60 + 30) * 60_000)
    })
    expect(line(container)).toBeNull()
    act(() => {
      vi.advanceTimersByTime((5 * 60 + 30) * 60_000)
    })
    expect(lines(container)).toHaveLength(1)
    expect(columnOf(line(container)!)).toBe('Wed')
    expect(line(container)!.style.top).toBe('36px')
  })

  describe('where it opens', () => {
    beforeEach(() => {
      // jsdom lays nothing out; the calendar is a 400px box here.
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 })
    })
    afterEach(() => {
      delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
    })

    it('opens on the now line when the week would open with it out of sight', () => {
      // Monday's 6 pm session would open it at 5 pm; at 8 am that hides the line.
      vi.setSystemTime(at(24, 8))
      const { container } = render(<WeekCalendar blocks={[monday]} minutesPerDay={120} readOnly />)
      expect(scroller(container).scrollTop).toBe(52)
    })

    it('opens an hour before the earliest block when the line is in sight there, and stays put as it moves', () => {
      vi.setSystemTime(at(24, 18, 30))
      const { container } = render(<WeekCalendar blocks={[monday]} minutesPerDay={120} readOnly />)
      expect(scroller(container).scrollTop).toBe(572)
      scroller(container).scrollTop = 100
      act(() => {
        vi.advanceTimersByTime(5 * 60_000)
      })
      expect(scroller(container).scrollTop).toBe(100)
    })
  })
})
