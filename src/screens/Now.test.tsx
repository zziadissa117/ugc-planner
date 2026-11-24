// TODAY, the home screen: today off the week he placed, the Trybe timer and
// its count, the posts line, a countdown for warm-ups, a way into hooks and
// the week as a calendar. The FILM console, the FILM and POST tiles, "Mark
// edited", the warm-up queue and the dictated list are gone, and tested gone.

import 'fake-indexeddb/auto'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DataContext } from '../data/context'
import type { DataAdapter } from '../data/DataAdapter'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { INFLOW_CAMPAIGN_ID, ensureSeeded } from '../data/seed'
import type { NewPlanBlock } from '../data'
import { readTimers } from '../warmupTimer'
import { WarmupTimersProvider } from '../warmupTimers'
import { Now } from './Now'

vi.mock('../sound', () => ({ playWarmupDone: vi.fn(), unlockAudio: vi.fn() }))

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: DataAdapter

// Stored weekdays: 0 = Monday. 2026-11-22 is a Sunday, so 24 November is a
// Tuesday - a recording day at 6 pm. Local times, like the device's.
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m)
const WEEK: NewPlanBlock[] = [
  { kind: 'record', weekday: 1, start_minute: 18 * 60, duration_minutes: 120 }, // Tue 6 pm
  { kind: 'ideate', weekday: 2, start_minute: 10 * 60, duration_minutes: 60 }, // Wed 10 am
  { kind: 'record', weekday: 3, start_minute: 18 * 60, duration_minutes: 120 }, // Thu 6 pm
  { kind: 'record', weekday: 5, start_minute: 9 * 60, duration_minutes: 120 }, // Sat 9 am
]

beforeEach(async () => {
  // Only the date is faked: IndexedDB still needs real timeouts.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at(24, 18, 30))
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`now-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
  await ensureSeeded(adapter)
  await adapter.replacePlanBlocks(WEEK)
  await adapter.updateUserSettings({ minutes_per_day: 120 })
})

afterEach(() => {
  vi.useRealTimers()
})

function renderScreen() {
  return render(
    <DataContext.Provider value={adapter}>
      <MemoryRouter>
        <WarmupTimersProvider>
          <Now />
        </WarmupTimersProvider>
      </MemoryRouter>
    </DataContext.Provider>,
  )
}

const sessions = () => within(screen.getByRole('region', { name: "Today's sessions" }))
const trybe = () => within(screen.getByRole('region', { name: 'Trybe videos' }))
/** The Trybe card, once the screen has read its rows. */
const trybeLoaded = async () => within(await screen.findByRole('region', { name: 'Trybe videos' }))

describe("today's sessions, from the week he placed", () => {
  it('opens on the session on now, at its time, with what it holds', async () => {
    renderScreen()
    expect(await screen.findByRole('heading', { name: 'Recording now' })).toBeInTheDocument()
    expect(sessions().getByText('6:00 – 8:00 pm')).toBeInTheDocument()
    expect(sessions().getByText('Record: 1h Trybe videos, then 1h Base UGC')).toBeInTheDocument()
    expect(sessions().getByText('Now')).toBeInTheDocument()
    expect(sessions().getByText('Trybe videos until 7:00 pm, then Base UGC')).toBeInTheDocument()
  })

  it('says how far off a session later today is', async () => {
    vi.setSystemTime(at(24, 15, 50))
    renderScreen()
    expect(await screen.findByRole('heading', { name: 'Recording at 6:00 pm' })).toBeInTheDocument()
    expect(sessions().getByText('in 2h 10m')).toBeInTheDocument()
  })

  it('fades a finished session and says when the next one is', async () => {
    vi.setSystemTime(at(24, 21))
    renderScreen()
    expect(await screen.findByRole('heading', { name: 'No more sessions today' })).toBeInTheDocument()
    expect(sessions().getByText('Ended')).toBeInTheDocument()
    expect(sessions().getByText(/Next:/)).toHaveTextContent('Next: tomorrow 10:00 am · Ideate · A/B test · improve')
  })

  it('says so plainly on a day with no session, and when the next one is', async () => {
    vi.setSystemTime(at(23, 12))
    renderScreen()
    expect(await screen.findByRole('heading', { name: 'No session today' })).toBeInTheDocument()
    expect(sessions().getByText('No session today.')).toBeInTheDocument()
    expect(sessions().getByText(/Next:/)).toHaveTextContent('Next: tomorrow 6:00 pm · Record')
  })

  it('shows the week as a calendar, with a way to change it', async () => {
    renderScreen()
    const week = within(await screen.findByRole('region', { name: 'Your week' }))
    expect(week.getByRole('link', { name: 'Edit my week' })).toHaveAttribute('href', '/start')
    expect(week.getByRole('button', { name: 'Tue 6:00 pm Record' })).toBeDisabled()
  })
})

describe('Trybe videos', () => {
  it('logs a row for every +1 and counts today and this week from the rows', async () => {
    // Earlier this week (Sunday) counts for the week; last Saturday does not.
    await adapter.logTrybeVideo(at(22, 10))
    await adapter.logTrybeVideo(at(21, 10))
    renderScreen()
    expect(await (await trybeLoaded()).findByText('Today: 0')).toBeInTheDocument()
    expect(trybe().getByText('This week: 1')).toBeInTheDocument()

    fireEvent.click(trybe().getByRole('button', { name: '+1 video' }))
    expect(await trybe().findByText('Today: 1')).toBeInTheDocument()
    fireEvent.click(trybe().getByRole('button', { name: '+1 video' }))
    expect(await trybe().findByText('Today: 2')).toBeInTheDocument()
    expect(trybe().getByText('This week: 3')).toBeInTheDocument()

    expect(await adapter.listTrybeVideos()).toHaveLength(4)
  })

  it("undoes the last tap today, and offers nothing to undo before there is one", async () => {
    await adapter.logTrybeVideo(at(22, 10))
    renderScreen()
    await (await trybeLoaded()).findByText('This week: 1')
    // A video from Sunday is not today's to take back.
    expect(trybe().queryByRole('button', { name: 'Undo last' })).toBeNull()

    fireEvent.click(trybe().getByRole('button', { name: '+1 video' }))
    fireEvent.click(await trybe().findByRole('button', { name: 'Undo last' }))
    expect(await (await trybeLoaded()).findByText('Today: 0')).toBeInTheDocument()
    expect(trybe().getByText('This week: 1')).toBeInTheDocument()
    const left = await adapter.listTrybeVideos()
    expect(left.map((v) => v.made_at)).toEqual([at(22, 10).toISOString()])
  })

  it('times the Trybe part of his day, and keeps running after a reload', async () => {
    const first = renderScreen()
    fireEvent.click(await (await trybeLoaded()).findByRole('button', { name: 'Start 1h timer' }))
    expect(trybe().getByLabelText('60:00 left')).toBeInTheDocument()
    expect(readTimers()).toEqual([expect.objectContaining({ kind: 'trybe', minutes: 60 })])
    first.unmount()

    vi.setSystemTime(at(24, 18, 40))
    renderScreen()
    expect(await (await trybeLoaded()).findByLabelText('50:00 left')).toBeInTheDocument()
    expect(trybe().getByRole('button', { name: 'Stop timer' })).toBeInTheDocument()
    // Both countdowns are on this screen, so the strip at the top is not.
    expect(screen.queryByRole('region', { name: 'Timers' })).toBeNull()
  })

  it('is as long as the Trybe part of a shorter day', async () => {
    await adapter.updateUserSettings({ minutes_per_day: 90 })
    renderScreen()
    expect(await (await trybeLoaded()).findByRole('button', { name: 'Start 45m timer' })).toBeInTheDocument()
  })

  it('works on a day with no recording session too', async () => {
    vi.setSystemTime(at(23, 12))
    renderScreen()
    fireEvent.click(await (await trybeLoaded()).findByRole('button', { name: '+1 video' }))
    expect(await trybe().findByText('Today: 1')).toBeInTheDocument()
  })
})

describe('the rest of today', () => {
  it('has a countdown used for warm-ups, started from a preset', async () => {
    renderScreen()
    const timer = within(await screen.findByRole('region', { name: 'Timer' }))
    expect(timer.getByText('Used for warm-ups')).toBeInTheDocument()

    fireEvent.click(timer.getByRole('button', { name: 'Start a 10 minute timer' }))
    expect(timer.getByLabelText('10:00 left')).toBeInTheDocument()
    expect(readTimers()).toEqual([expect.objectContaining({ kind: 'warmup', minutes: 10 })])

    fireEvent.click(timer.getByRole('button', { name: 'Stop' }))
    expect(readTimers()).toEqual([])
    expect(timer.getByRole('button', { name: 'Start a 5 minute timer' })).toBeInTheDocument()
  })

  it("counts today's posts the way the Post tab does, one tap from it", async () => {
    renderScreen()
    // Inflow's seed owes one a day, and nothing has gone out.
    const posts = await screen.findByRole('link', { name: /^Posts/ })
    expect(posts).toHaveAttribute('href', '/post')
    expect(posts).toHaveTextContent('0 of 1 posted today')
  })

  it('counts a deliverable once however many platforms it went out on', async () => {
    const accounts = await adapter.listCampaignAccounts(INFLOW_CAMPAIGN_ID)
    const video = await adapter.createVideo({
      campaign_id: INFLOW_CAMPAIGN_ID,
      setup: 'face',
      angle_id: null,
      script: null,
      blocked_reason: null,
      owed_for_date: null,
      rate_snapshot_cents: null,
      posted_at: null,
    })
    for (const account of accounts) {
      await adapter.addVideoPost({
        video_id: video.id,
        account_id: account.id,
        platform: account.platform,
        url: null,
        view_count: null,
        view_count_entered_at: null,
      })
    }
    expect(accounts.length).toBeGreaterThan(1)

    renderScreen()
    expect(await screen.findByRole('link', { name: /^Posts/ })).toHaveTextContent('1 of 1 posted today')
  })

  it("links each campaign to its hooks", async () => {
    renderScreen()
    const hooks = within(await screen.findByRole('region', { name: 'Hooks' }))
    const link = hooks.getByRole('link', { name: /Inflow/ })
    expect(link).toHaveAttribute('href', `/campaigns/${INFLOW_CAMPAIGN_ID}#hooks`)
    // No hook generator deployed in tests: he writes them.
    expect(link).toHaveTextContent('Write hooks')
  })
})

describe('what is gone', () => {
  it('has no FILM console, no tiles, no edit backlog, no warm-up queue and no dictated list', async () => {
    // A filmed video used to put "Mark edited" here.
    const video = await adapter.createVideo({
      campaign_id: INFLOW_CAMPAIGN_ID,
      setup: 'face',
      angle_id: null,
      script: null,
      blocked_reason: null,
      owed_for_date: null,
      rate_snapshot_cents: null,
      posted_at: null,
    })
    await adapter.advanceVideoPhase(video.id, { session: 'film' })

    renderScreen()
    await screen.findByRole('heading', { name: 'Recording now' })

    expect(screen.queryByRole('button', { name: 'FILM' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'POST' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mark edited' })).toBeNull()
    expect(screen.queryByText(/ready to edit/)).toBeNull()
    expect(screen.queryByText(/Warm up next/i)).toBeNull()
    expect(screen.queryByText('All accounts')).toBeNull()
    expect(screen.queryByText(/Start warm-up/)).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Your dictation' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Add a line by hand' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start working' })).toBeNull()
    expect(screen.queryByText(/Start filming/)).toBeNull()
  })

  it('reads the day again when a sync brings new rows', async () => {
    renderScreen()
    await (await trybeLoaded()).findByText('Today: 0')
    await adapter.logTrybeVideo(at(24, 18, 20))
    act(() => {
      window.dispatchEvent(new Event('ugc-planner:data-changed'))
    })
    await waitFor(() => expect(trybe().getByText('Today: 1')).toBeInTheDocument())
  })
})
