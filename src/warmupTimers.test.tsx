// The countdowns outliving the screen that started them: the Trybe timer and
// the plain one used for warm-ups.
//
// "if I leave the page for 2 seconds to just go check on my setups, I don't
// want to come back to the Now page and have the timer reset." A timer used
// to be state inside the home screen, so navigating away threw it out.

import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readTimers } from './warmupTimer'
import { WarmupTimersProvider, useTimers } from './warmupTimers'

vi.mock('./sound', () => ({
  playWarmupDone: vi.fn(),
  unlockAudio: vi.fn(),
}))
import { playWarmupDone, unlockAudio } from './sound'

const STORAGE_KEY = 'ugc-planner.warmup_timers'

/** A stand-in for TODAY and the other screens: buttons to start a countdown,
 *  to move between routes, and a readout of where it is. */
function Screens() {
  const timers = useTimers()
  const navigate = useNavigate()
  const location = useLocation()
  return (
    <div>
      <p data-testid="where">{location.pathname}</p>
      <button onClick={() => timers.start('trybe', 60)}>start trybe</button>
      <button onClick={() => timers.start('warmup', 5)}>start warm-up</button>
      <button onClick={() => timers.setOnScreen(true)}>on today</button>
      <button onClick={() => navigate('/post')}>go post</button>
      <button onClick={() => navigate('/')}>go today</button>
    </div>
  )
}

function App() {
  return (
    <MemoryRouter>
      <WarmupTimersProvider>
        <Routes>
          <Route path="*" element={<Screens />} />
        </Routes>
      </WarmupTimersProvider>
    </MemoryRouter>
  )
}

const strip = () => screen.queryByRole('region', { name: 'Timers' })

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEY)
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date('2026-11-24T23:00:00.000Z'))
  vi.mocked(playWarmupDone).mockClear()
  vi.mocked(unlockAudio).mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

describe('a running countdown', () => {
  it('shows nowhere until one is started', () => {
    render(<App />)
    expect(strip()).toBeNull()
  })

  it('starts from a tap, unlocks audio for the chime, and counts down at the top of the page', () => {
    render(<App />)
    fireEvent.click(screen.getByText('start trybe'))

    expect(unlockAudio).toHaveBeenCalled()
    expect(strip()).toHaveTextContent('Trybe videos')
    expect(strip()).toHaveTextContent('60:00')

    advance(65_000)
    expect(strip()).toHaveTextContent('58:55')
  })

  it('runs the Trybe timer and a warm-up side by side', () => {
    render(<App />)
    fireEvent.click(screen.getByText('start trybe'))
    fireEvent.click(screen.getByText('start warm-up'))
    expect(strip()).toHaveTextContent('Trybe videos')
    expect(strip()).toHaveTextContent('Warm-up')
    expect(strip()).toHaveTextContent('05:00')
    expect(readTimers().map((t) => t.kind).sort()).toEqual(['trybe', 'warmup'])
  })

  it('is still there, and still counting, after he goes to another screen', () => {
    render(<App />)
    fireEvent.click(screen.getByText('start warm-up'))
    advance(2_000)

    fireEvent.click(screen.getByText('go post'))
    expect(screen.getByTestId('where')).toHaveTextContent('/post')
    expect(strip()).toHaveTextContent('04:58')

    advance(60_000)
    fireEvent.click(screen.getByText('go today'))
    expect(strip()).toHaveTextContent('03:58')
  })

  it('survives the whole app being reloaded, and is right for the time away', () => {
    const first = render(<App />)
    fireEvent.click(screen.getByText('start trybe'))
    first.unmount()

    // Ten minutes pass with nothing mounted at all - a reload, a lock screen.
    vi.setSystemTime(Date.now() + 10 * 60_000)

    render(<App />)
    expect(strip()).toHaveTextContent('50:00')
  })

  it('does not restart one that is already running when start is tapped again', () => {
    render(<App />)
    fireEvent.click(screen.getByText('start warm-up'))
    advance(30_000)
    fireEvent.click(screen.getByText('start warm-up'))
    expect(strip()).toHaveTextContent('04:30')
  })

  it('hides the strip while TODAY shows the countdowns full size', () => {
    render(<App />)
    fireEvent.click(screen.getByText('start warm-up'))
    expect(strip()).not.toBeNull()

    fireEvent.click(screen.getByText('on today'))
    expect(strip()).toBeNull()
  })

  it('goes back to TODAY when the strip is tapped', () => {
    render(<App />)
    fireEvent.click(screen.getByText('start trybe'))
    fireEvent.click(screen.getByText('go post'))

    fireEvent.click(screen.getByRole('button', { name: 'Open the Trybe videos timer' }))
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/)
  })

  it('puts the time left in the tab title, and puts the title back when it is gone', () => {
    document.title = 'UGC planner'
    render(<App />)
    fireEvent.click(screen.getByText('start warm-up'))
    expect(document.title).toBe('05:00 Warm-up')

    advance(90_000)
    expect(document.title).toBe('03:30 Warm-up')

    fireEvent.click(screen.getByRole('button', { name: 'Stop the Warm-up timer' }))
    expect(document.title).toBe('UGC planner')
    expect(readTimers()).toEqual([])
  })

  it('drops a per-account timer left in storage by the old warm-up list', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { accountId: 'acc-1', platform: 'TikTok', handle: '@x', campaignName: 'Inflow', minutes: 5, startedAt: Date.now(), endsAt: Date.now() + 300_000, alerted: false },
      ]),
    )
    render(<App />)
    expect(strip()).toBeNull()
  })
})

describe('when the time is up', () => {
  it('plays the chime once, however long it sits there', () => {
    render(<App />)
    fireEvent.click(screen.getByText('start warm-up'))

    advance(5 * 60_000 - 1_000)
    expect(playWarmupDone).not.toHaveBeenCalled()

    advance(1_000)
    expect(playWarmupDone).toHaveBeenCalledTimes(1)
    expect(strip()).toHaveTextContent("Time's up")
    expect(strip()).toHaveTextContent('00:00')

    advance(60_000)
    expect(playWarmupDone).toHaveBeenCalledTimes(1)
  })

  it('chimes for the Trybe timer too, at the hour', () => {
    render(<App />)
    fireEvent.click(screen.getByText('start trybe'))
    advance(60 * 60_000)
    expect(playWarmupDone).toHaveBeenCalledTimes(1)
    expect(document.title).toBe("Time's up - Trybe videos")
  })

  it('rings at the end time even if the once-a-second tick never runs', () => {
    // A hidden tab can be throttled to about one tick a minute. With the tick
    // switched off entirely, only the one-shot wake-up set for the end time is
    // left to notice that the countdown has run out.
    const noTick = vi.spyOn(window, 'setInterval').mockImplementation(() => 0)
    try {
      render(<App />)
      fireEvent.click(screen.getByText('start warm-up'))
      expect(playWarmupDone).not.toHaveBeenCalled()

      act(() => {
        vi.setSystemTime(Date.now() + 5 * 60_000)
        vi.advanceTimersByTime(5 * 60_000 + 100)
      })
      expect(playWarmupDone).toHaveBeenCalledTimes(1)
    } finally {
      noTick.mockRestore()
    }
  })

  it('does not ring again after a reload once it has already rung', () => {
    const first = render(<App />)
    fireEvent.click(screen.getByText('start warm-up'))
    advance(5 * 60_000)
    expect(playWarmupDone).toHaveBeenCalledTimes(1)
    first.unmount()

    render(<App />)
    advance(5_000)
    expect(playWarmupDone).toHaveBeenCalledTimes(1)
    expect(strip()).toHaveTextContent("Time's up")
  })

  it('rings when he comes back to one that ran out while the app was closed', () => {
    const first = render(<App />)
    fireEvent.click(screen.getByText('start warm-up'))
    first.unmount()

    vi.setSystemTime(Date.now() + 10 * 60_000)
    render(<App />)
    advance(1_000)
    expect(playWarmupDone).toHaveBeenCalledTimes(1)
  })

  it('is cleared with one tap on the strip, recording nothing', () => {
    render(<App />)
    fireEvent.click(screen.getByText('start warm-up'))
    advance(5 * 60_000)

    fireEvent.click(screen.getByRole('button', { name: 'Clear the Warm-up timer' }))
    expect(strip()).toBeNull()
    expect(readTimers()).toEqual([])
  })

  it('can be started again once it has run out', () => {
    render(<App />)
    fireEvent.click(screen.getByText('start warm-up'))
    advance(5 * 60_000)
    fireEvent.click(screen.getByText('start warm-up'))
    expect(strip()).toHaveTextContent('05:00')
    expect(strip()).not.toHaveTextContent("Time's up")
  })
})
