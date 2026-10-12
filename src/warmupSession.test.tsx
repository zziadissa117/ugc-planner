// Warm-up sessions: one account at a time, new ones first, and each timer
// running out marks it warmed and starts the next by itself.

import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Campaign, CampaignAccount, WarmupEvent } from './data'
import { DataContext } from './data/context'
import type { DataAdapter } from './data/DataAdapter'
import { readTimers } from './warmupTimer'
import { WarmupTimersProvider, useWarmupTimers } from './warmupTimers'
import { advance, current, readSession, sessionItem, startSession, warmupQueue } from './warmupSession'

vi.mock('./sound', () => ({ playWarmupDone: vi.fn(), unlockAudio: vi.fn() }))

const NOW = new Date('2026-10-12T20:00:00').getTime()
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString()

const acc = (id: string, status: CampaignAccount['status'], campaign = 'c1', platform = 'TikTok') =>
  ({ id, campaign_id: campaign, platform, handle: `@${id}`, status, is_active: true }) as CampaignAccount
const warmed = (accountId: string, at: string) => ({ account_id: accountId, occurred_at: at, minutes: 15 }) as WarmupEvent
const campaigns = [{ id: 'c1', name: 'Inflow' }, { id: 'c2', name: 'Vertus' }] as Campaign[]

describe('the order a session takes them', () => {
  it('new accounts first, then the neglected, then the warming, then the ready - and none warmed today', () => {
    const accounts = [acc('ready', 'ready'), acc('neglected', 'ready'), acc('brand-new', 'new'), acc('halfway', 'warming'), acc('done-today', 'ready')]
    const events = [warmed('ready', daysAgo(1)), warmed('neglected', daysAgo(9)), warmed('halfway', daysAgo(1)), warmed('done-today', new Date(NOW - 3_600_000).toISOString())]
    const queue = warmupQueue(accounts, campaigns, events, new Map(), NOW)
    expect(queue.map((q) => q.account.id)).toEqual(['brand-new', 'neglected', 'halfway', 'ready'])
  })

  it('inside a tier, the campaign that pays best first', () => {
    const accounts = [acc('low', 'new', 'c2'), acc('high', 'new', 'c1')]
    const queue = warmupQueue(accounts, campaigns, [], new Map([['c1', 0], ['c2', 1]]), NOW)
    expect(queue.map((q) => q.account.id)).toEqual(['high', 'low'])
  })
})

describe('moving through a session', () => {
  it('goes one account after another and ends after the last', () => {
    const session = startSession([sessionItem(acc('a', 'new'), 'Inflow'), sessionItem(acc('b', 'ready'), 'Inflow')])!
    expect(current(session)?.accountId).toBe('a')
    const second = advance(session, true)!
    expect(current(second)?.accountId).toBe('b')
    expect(second.warmed).toBe(1)
    expect(advance(second, false)).toBeNull()
  })
})

const record = vi.fn(async () => ({}))
const adapter = { recordWarmupEvent: record } as unknown as DataAdapter
const first = acc('first', 'new')
const second = acc('second', 'ready')

function Controls() {
  const t = useWarmupTimers()
  return (
    <div>
      <p data-testid="current">{current(t.session)?.accountId ?? 'none'}</p>
      <p data-testid="timers">{t.timers.map((x) => x.accountId).join(',')}</p>
      <button onClick={() => t.startSession([sessionItem(first, 'Inflow'), sessionItem(second, 'Vertus')])}>start</button>
      <button onClick={t.skip}>skip</button>
      <button onClick={() => t.pauseSession(true)}>pause</button>
    </div>
  )
}

function App() {
  return (
    <DataContext.Provider value={adapter}>
      <MemoryRouter>
        <WarmupTimersProvider>
          <Controls />
        </WarmupTimersProvider>
      </MemoryRouter>
    </DataContext.Provider>
  )
}

const text = (id: string) => screen.getByTestId(id).textContent

describe('a running session', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(NOW)
    record.mockClear()
  })
  afterEach(() => vi.useRealTimers())

  it("starts the first timer at once, and when it runs out marks it warmed and starts the next with no tap", async () => {
    render(<App />)
    fireEvent.click(screen.getByText('start'))
    expect(text('current')).toBe('first')
    expect(text('timers')).toBe('first')
    expect(readTimers()[0].minutes).toBe(15)

    await act(async () => {
      vi.advanceTimersByTime(15 * 60_000 + 1000)
    })
    expect(record).toHaveBeenCalledWith('first', 15)
    expect(text('current')).toBe('second')
    expect(text('timers')).toBe('second')

    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000 + 1000)
    })
    expect(record).toHaveBeenCalledWith('second', 5)
    expect(text('current')).toBe('none')
    expect(text('timers')).toBe('')
    expect(readSession()).toBeNull()
  })

  it('skip moves on without recording anything', async () => {
    render(<App />)
    fireEvent.click(screen.getByText('start'))
    fireEvent.click(screen.getByText('skip'))
    expect(record).not.toHaveBeenCalled()
    expect(text('current')).toBe('second')
    expect(text('timers')).toBe('second')
  })

  it('paused, a finished timer waits for his tap and nothing new starts', async () => {
    render(<App />)
    fireEvent.click(screen.getByText('start'))
    fireEvent.click(screen.getByText('pause'))
    await act(async () => {
      vi.advanceTimersByTime(16 * 60_000)
    })
    expect(record).not.toHaveBeenCalled()
    expect(text('current')).toBe('first')
  })
})
