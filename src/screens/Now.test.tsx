// TODAY, the home screen, top to bottom: the week as a calendar, what is going
// out, today off the week he placed, the Trybe timer and its count, a
// countdown for warm-ups, and one way into hook generation. The FILM console,
// the FILM and POST tiles, "Mark edited", the warm-up queue, the dictated list
// and the posts row are gone, and tested gone.

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
const loadPostizPosts = vi.fn()
vi.mock('../sync/postizPosts', () => ({ loadPostizPosts: (range: unknown) => loadPostizPosts(range) }))

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
  loadPostizPosts.mockReset().mockResolvedValue({ connected: false, posts: [], reading: 0 })
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
    const week = within(await screen.findByRole('region', { name: 'My week' }))
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

  it('has one button into hook generation, not a row per campaign', async () => {
    renderScreen()
    const hooks = within(await screen.findByRole('region', { name: 'Hooks' }))
    expect(hooks.getByRole('link', { name: 'Hook generation' })).toHaveAttribute('href', '/hooks')
    expect(hooks.queryByRole('link', { name: /Inflow/ })).toBeNull()
  })

  it('puts the week on top, what is going out under it, and the timer and hooks at the bottom', async () => {
    renderScreen()
    await screen.findByRole('region', { name: 'Hooks' })
    const order = ['My week', 'Going out', "Today's sessions", 'Trybe videos', 'Hooks'].map((name) => screen.getByRole('region', { name }))
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    const timer = screen.getByText('Used for warm-ups')
    expect(order[3].compareDocumentPosition(timer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(timer.compareDocumentPosition(order[4]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('going out', () => {
  const post = (over: Record<string, unknown>) => ({
    id: crypto.randomUUID(),
    group: null,
    platform: 'Instagram',
    handle: 'traderzi',
    url: null,
    preview: null,
    previewKind: null,
    caption: 'First line\nmore',
    status: 'scheduled',
    publishedAt: at(24, 20).toISOString(),
    views: null,
    viewsAt: null,
    campaign: null,
    ...over,
  })
  const GODADDY = { id: 'cut-gd', name: 'GoDaddy' }
  /** One cutter video sent to his Instagram and TikTok: two posts, one video. */
  const video = (group: string, over: Record<string, unknown>) => [
    post({ group, platform: 'TikTok', campaign: GODADDY, ...over, url: null }),
    post({ group, platform: 'Instagram', campaign: GODADDY, ...over }),
  ]

  async function withGoDaddy() {
    // 21 a week: 3 a day.
    await adapter.createCampaign({
      name: 'GoDaddy',
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      posts_per_week: 21,
      pay_per_video_cents: 1000,
      cycle_size: null,
      cutter_campaign_id: 'cut-gd',
    })
    loadPostizPosts.mockResolvedValue({
      connected: true,
      reading: 0,
      source: 'cutter',
      posts: [
        ...video('a', { status: 'posted', url: 'https://instagram.com/p/a', publishedAt: at(24, 9).toISOString(), caption: 'Day 4 of trading\nmore' }),
        ...video('b', { status: 'posted', url: 'https://instagram.com/p/b', publishedAt: at(24, 12).toISOString() }),
        ...video('c', { status: 'scheduled', publishedAt: at(24, 20).toISOString() }),
        post({ handle: 'traderzi2', campaign: { id: 'cut-trial', name: 'Trial reels' }, status: 'waiting', publishedAt: at(24, 21).toISOString() }),
      ],
    })
  }

  const going = async () => within(await screen.findByRole('region', { name: 'Going out' }))
  const rows = async () => (await (await going()).findAllByRole('button')).map((b) => b.textContent)

  it('shows each campaign as X of Y, videos not accounts, the ones still short first', async () => {
    await withGoDaddy()
    renderScreen()
    await waitFor(async () => expect(await rows()).toHaveLength(3))
    const [inflow, godaddy, trial] = await rows()
    // Inflow owes 1 today and has nothing lined up: that is what is next.
    expect(inflow).toContain('Inflow')
    expect(inflow).toContain('0 of 1')
    expect(inflow).toContain('1 to go')
    // Three videos on two accounts each: 3 of 3, nothing to go.
    expect(godaddy).toContain('GoDaddy')
    expect(godaddy).toContain('3 of 3')
    expect(godaddy).toContain('2 out · 1 scheduled')
    expect(godaddy).not.toContain('to go')
    // A cutter campaign the planner has no campaign for: no quota to show.
    expect(trial).toContain('Trial reels')
    expect(trial).toContain('0 today')
    expect(trial).toContain('1 to approve')
    // Today's range: midnight to midnight.
    expect(loadPostizPosts).toHaveBeenCalledWith({ from: at(24, 0).toISOString(), to: at(25, 0).toISOString() })
  })

  it('opens a campaign to one row per video, the posted ones opening on Instagram', async () => {
    await withGoDaddy()
    renderScreen()
    const section = await going()
    const godaddy = await section.findByRole('button', { name: /^GoDaddy/ })
    expect(godaddy).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(godaddy)
    expect(godaddy).toHaveAttribute('aria-expanded', 'true')
    const videos = within(section.getByRole('list', { name: 'GoDaddy videos' })).getAllByRole('listitem')
    expect(videos).toHaveLength(3)
    expect(videos[0]).toHaveTextContent('9:00 am')
    expect(videos[0]).toHaveTextContent('Out')
    expect(videos[0]).toHaveTextContent('Day 4 of trading')
    expect(videos[0]).toHaveTextContent('Instagram, TikTok')
    expect(within(videos[0]).getByRole('link')).toHaveAttribute('href', 'https://instagram.com/p/a')
    expect(videos[2]).toHaveTextContent('8:00 pm')
    expect(videos[2]).toHaveTextContent('Scheduled')
    expect(within(videos[2]).queryByRole('link')).toBeNull()

    fireEvent.click(godaddy)
    expect(section.queryByRole('list', { name: 'GoDaddy videos' })).toBeNull()
  })

  it('switches to this week, Sunday to Sunday, against what the week owes', async () => {
    await withGoDaddy()
    renderScreen()
    const section = await going()
    await section.findByRole('button', { name: /^GoDaddy/ })
    fireEvent.click(section.getByRole('tab', { name: 'This week' }))
    await waitFor(() => expect(loadPostizPosts).toHaveBeenCalledWith({ from: at(22, 0).toISOString(), to: at(29, 0).toISOString() }))
    expect(await section.findByRole('button', { name: /^GoDaddy/ })).toHaveTextContent('3 of 21')
    expect(section.getByRole('button', { name: /^GoDaddy/ })).toHaveTextContent('18 to go')
    expect(section.getByRole('button', { name: /^Trial reels/ })).toHaveTextContent('0 this week')
  })

  it('says where to add a Postiz key when there is none', async () => {
    renderScreen()
    expect(await (await going()).findByRole('link', { name: 'Add your Postiz key' })).toHaveAttribute('href', '/settings#postiz')
  })

  it("says a Postiz problem in one quiet line, and never one from the cutter's records", async () => {
    const problem = "This hour's Postiz requests for your key are used up, so the newest posts may be missing."
    loadPostizPosts.mockResolvedValue({ connected: true, reading: 0, source: 'postiz', posts: [], error: problem })
    const first = renderScreen()
    const line = await (await going()).findByText(problem)
    expect(line.className).toContain('text-text-dim')
    expect(line.className).not.toMatch(/state-blocked|state-waiting/)
    first.unmount()

    loadPostizPosts.mockResolvedValue({ connected: true, reading: 0, source: 'cutter', posts: [], error: problem })
    renderScreen()
    await (await going()).findByRole('button', { name: /^Inflow/ })
    expect(screen.queryByText(problem)).toBeNull()
  })

  it('counts nothing when the read itself failed', async () => {
    loadPostizPosts.mockRejectedValue(new Error('Could not reach the server.'))
    renderScreen()
    const section = await going()
    expect(await section.findByText('Could not reach the server.')).toBeInTheDocument()
    expect(section.queryByRole('button', { name: /^Inflow/ })).toBeNull()
  })

  it('needs a connection, and says so quietly', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      renderScreen()
      expect(await (await going()).findByText('Going out needs a connection.')).toBeInTheDocument()
      expect(loadPostizPosts).not.toHaveBeenCalled()
    } finally {
      onLine.mockRestore()
    }
  })

  it('is not there at all when signed out', async () => {
    loadPostizPosts.mockResolvedValue(null)
    renderScreen()
    await screen.findByRole('region', { name: 'Hooks' })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Going out' })).toBeNull())
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
    expect(screen.queryByRole('link', { name: /^Posts/ })).toBeNull()
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
