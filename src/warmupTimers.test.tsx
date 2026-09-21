// The warm-up timer outliving the screen that started it.
//
// "if I leave the page for 2 seconds to just go check on my setups, I don't
// want to come back to the Now page and have the timer reset." The timer used
// to be state inside the Now screen, so navigating away threw it out.

import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CampaignAccount } from './data'
import { DataContext } from './data/context'
import type { DataAdapter } from './data/DataAdapter'
import { readTimers } from './warmupTimer'
import { WarmupTimersProvider, useWarmupTimers } from './warmupTimers'

vi.mock('./sound', () => ({
  playWarmupDone: vi.fn(),
  unlockAudio: vi.fn(),
}))
import { playWarmupDone, unlockAudio } from './sound'

const STORAGE_KEY = 'ugc-planner.warmup_timers'

const account = {
  id: 'acc-1',
  campaign_id: 'camp-1',
  platform: 'TikTok',
  handle: '@michael.financier',
  status: 'ready',
} as CampaignAccount

const record = vi.fn(async () => ({}))
const adapter = { recordWarmupEvent: record } as unknown as DataAdapter

/** A stand-in for the Now screen and the Post screen: buttons to start a
 *  timer, to move between routes, and a readout of where it is. */
function Screens() {
  const timers = useWarmupTimers()
  const navigate = useNavigate()
  const location = useLocation()
  return (
    <div>
      <p data-testid="where">{location.pathname}</p>
      <p data-testid="state">{JSON.stringify(location.state)}</p>
      <p data-testid="completions">{timers.completions}</p>
      <button onClick={() => timers.start(account, 'Inflow')}>start</button>
      <button onClick={() => timers.setViewing(account.id)}>view</button>
      <button onClick={() => navigate('/post')}>go post</button>
      <button onClick={() => navigate('/')}>go now</button>
    </div>
  )
}

function App() {
  return (
    <DataContext.Provider value={adapter}>
      <MemoryRouter>
        <WarmupTimersProvider>
          <Routes>
            <Route path="*" element={<Screens />} />
          </Routes>
        </WarmupTimersProvider>
      </MemoryRouter>
    </DataContext.Provider>
  )
}

const strip = () => screen.queryByRole('region', { name: 'Warm-up timers' })

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEY)
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date('2026-09-20T20:00:00.000Z'))
  vi.mocked(playWarmupDone).mockClear()
  vi.mocked(unlockAudio).mockClear()
  record.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms))

describe('a running warm-up timer', () => {
  it('shows nowhere until one is started', () => {
    render(<App />)
    expect(strip()).toBeNull()
  })

  it('starts from a tap, unlocks audio for the chime, and counts down at the top of the page', () => {
    render(<App />)
    fireEvent.click(screen.getByText('start'))

    expect(unlockAudio).toHaveBeenCalled()
    expect(strip()).toHaveTextContent('TikTok')
    // A ready account is a five-minute sitting.
    expect(strip()).toHaveTextContent('05:00')

    advance(65_000)
    expect(strip()).toHaveTextContent('03:55')
  })

  it('is still there, and still counting, after he goes to another screen', () => {
    render(<App />)
    fireEvent.click(screen.getByText('start'))
    advance(2_000)

    fireEvent.click(screen.getByText('go post'))
    expect(screen.getByTestId('where')).toHaveTextContent('/post')
    expect(strip()).toHaveTextContent('04:58')

    advance(60_000)
    fireEvent.click(screen.getByText('go now'))
    // Not reset: 2s + 60s gone, however many screens it crossed.
    expect(strip()).toHaveTextContent('03:58')
  })

  it('survives the whole app being reloaded, and is right for the time away', () => {
    const first = render(<App />)
    fireEvent.click(screen.getByText('start'))
    first.unmount()

    // Ten seconds pass with nothing mounted at all - a reload, a lock screen.
    vi.setSystemTime(Date.now() + 10_000)

    render(<App />)
    expect(strip()).toHaveTextContent('04:50')
  })

  it('does not restart a timer that is already running when start is tapped again', () => {
    render(<App />)
    fireEvent.click(screen.getByText('start'))
    advance(30_000)
    fireEvent.click(screen.getByText('start'))
    expect(strip()).toHaveTextContent('04:30')
  })

  it('does not show a second copy while its full-size screen is open', () => {
    render(<App />)
    fireEvent.click(screen.getByText('start'))
    expect(strip()).not.toBeNull()

    fireEvent.click(screen.getByText('view'))
    expect(strip()).toBeNull()
  })

  it('returns to the Now screen, opening that timer, when the strip is tapped', () => {
    render(<App />)
    fireEvent.click(screen.getByText('start'))
    fireEvent.click(screen.getByText('go post'))

    fireEvent.click(screen.getByRole('button', { name: /Open the TikTok warm-up timer/ }))
    expect(screen.getByTestId('where')).toHaveTextContent('/')
    expect(screen.getByTestId('state')).toHaveTextContent('acc-1')
  })

  it('can be cancelled without recording anything', () => {
    render(<App />)
    fireEvent.click(screen.getByText('start'))
    fireEvent.click(screen.getByRole('button', { name: /Cancel the TikTok timer/ }))

    expect(strip()).toBeNull()
    expect(readTimers()).toEqual([])
    expect(record).not.toHaveBeenCalled()
  })
})

describe('when the time is up', () => {
  it('plays the chime once, however long it sits there', () => {
    render(<App />)
    fireEvent.click(screen.getByText('start'))

    advance(5 * 60_000 - 1_000)
    expect(playWarmupDone).not.toHaveBeenCalled()

    advance(1_000)
    expect(playWarmupDone).toHaveBeenCalledTimes(1)
    expect(strip()).toHaveTextContent("Time's up")
    expect(strip()).toHaveTextContent('00:00')

    advance(60_000)
    expect(playWarmupDone).toHaveBeenCalledTimes(1)
  })

  it('rings even if he was on another screen when it ended', () => {
    render(<App />)
    fireEvent.click(screen.getByText('start'))
    fireEvent.click(screen.getByText('go post'))

    advance(5 * 60_000)
    expect(playWarmupDone).toHaveBeenCalledTimes(1)
  })

  it('does not ring again after a reload once it has already rung', () => {
    const first = render(<App />)
    fireEvent.click(screen.getByText('start'))
    advance(5 * 60_000)
    expect(playWarmupDone).toHaveBeenCalledTimes(1)
    first.unmount()

    render(<App />)
    advance(5_000)
    expect(playWarmupDone).toHaveBeenCalledTimes(1)
    expect(strip()).toHaveTextContent("Time's up")
  })

  it('rings when he comes back to a timer that ran out while the app was closed', () => {
    const first = render(<App />)
    fireEvent.click(screen.getByText('start'))
    first.unmount()

    vi.setSystemTime(Date.now() + 10 * 60_000)
    render(<App />)
    advance(1_000)
    expect(playWarmupDone).toHaveBeenCalledTimes(1)
  })

  it('records the session with one tap on the strip, and removes the timer', async () => {
    render(<App />)
    fireEvent.click(screen.getByText('start'))
    advance(5 * 60_000)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark warmed' }))
    })

    expect(record).toHaveBeenCalledWith('acc-1', 5)
    expect(strip()).toBeNull()
    expect(screen.getByTestId('completions')).toHaveTextContent('1')
    expect(readTimers()).toEqual([])
  })
})
