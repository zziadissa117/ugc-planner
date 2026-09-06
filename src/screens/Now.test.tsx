// The acceptance checks that live in the UI rather than the data layer:
// marking a video done is one tap, the row turns green, and it stays exactly
// where it was. A row that reorders or disappears shifts the ones below it out
// from under his thumb mid-tap, which is the specific failure this screen is
// designed around.

import 'fake-indexeddb/auto'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { DataContext } from '../data/context'
import type { DataAdapter } from '../data/DataAdapter'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { INFLOW_CAMPAIGN_ID, ensureSeeded } from '../data/seed'
import { SessionProvider } from '../session/SessionProvider'
import { Now } from './Now'
import { TickOff } from './TickOff'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: DataAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`now-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
  await ensureSeeded(adapter)
})

/** Gives the store more than one video to film, so ordering can be observed. */
async function seedFilmBacklog(count: number) {
  const campaign = await adapter.getCampaign(INFLOW_CAMPAIGN_ID)
  for (let i = 0; i < count; i++) {
    await adapter.createVideo({
      campaign_id: INFLOW_CAMPAIGN_ID,
      setup: campaign?.default_setup ?? 'face',
      angle_id: null,
      script: null,
      blocked_reason: null,
      // Supply built ahead of demand, so it is owed for no particular day.
      owed_for_date: null,
      rate_snapshot_cents: null,
      posted_at: null,
    })
  }
}

function renderScreen(element: React.ReactElement) {
  return render(
    <DataContext.Provider value={adapter}>
      <SessionProvider>
        <MemoryRouter>{element}</MemoryRouter>
      </SessionProvider>
    </DataContext.Provider>,
  )
}

/** Picks FILM and a 60 minute window, then the campaign (Inflow is the only
 *  one seeded, and its seed carries handles, so it never needs warming up)
 *  and past its do/don't briefing. Does not assume the list is non-empty:
 *  when a session has nothing at its stage there is no list to find. */
async function openFilmSession(user: ReturnType<typeof userEvent.setup>) {
  renderScreen(<Now />)
  await screen.findByText(/of 1 posted/)
  await user.click(screen.getByRole('button', { name: 'FILM' }))
  await user.click(screen.getByRole('button', { name: '60' }))
  await user.click(await screen.findByRole('button', { name: /Inflow/ }))
  await user.click(await screen.findByRole('button', { name: 'Start filming' }))
}

async function startFilmSession(user: ReturnType<typeof userEvent.setup>) {
  await openFilmSession(user)
  return screen.findByRole('list', { name: 'Tonight' })
}

describe('the NOW screen', () => {
  it('shows the time, what is owed today, and the runway line', async () => {
    renderScreen(<Now />)
    expect(await screen.findByText(/of 1 posted/)).toBeInTheDocument()
    expect(screen.getByText(/days of posts banked/)).toBeInTheDocument()
  })

  it('offers all four session types and the preset windows', async () => {
    renderScreen(<Now />)
    await screen.findByText(/of 1 posted/)

    for (const label of ['FILM', 'EDIT', 'POST', 'WARM-UP']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    for (const preset of ['30', '60', '90', '120']) {
      expect(screen.getByRole('button', { name: preset })).toBeInTheDocument()
    }
  })

  it('reaches the tick-off list without picking a session type', async () => {
    renderScreen(<Now />)
    await screen.findByText(/of 1 posted/)
    expect(
      screen.getByRole('link', { name: /already posted some\? tick them off/i }),
    ).toBeInTheDocument()
  })

  it('fills the window with film work, existing and newly generated', async () => {
    await seedFilmBacklog(2)
    const user = userEvent.setup()
    const list = await startFilmSession(user)

    // A 60 minute window at 12 film minutes a video: today's owed one, the two
    // already built ahead, and enough new supply to use the rest. He never
    // picked a count - the window decided.
    expect(within(list).getAllByRole('button')).toHaveLength(5)

    // Everything offered is film work, so everything starts undone.
    for (const row of within(list).getAllByRole('button')) {
      expect(row).toHaveAttribute('aria-pressed', 'false')
    }
  })

  it('marks a video done in one tap, turns it green, and leaves it in place', async () => {
    await seedFilmBacklog(2)
    const user = userEvent.setup()
    const list = await startFilmSession(user)

    const before = within(list)
      .getAllByRole('button')
      .map((button) => button.textContent)

    // Tap a middle row - the most disruptive one to move.
    const target = within(list).getAllByRole('button')[1]
    expect(target).toHaveAttribute('aria-pressed', 'false')
    await user.click(target)

    await waitFor(() => {
      expect(within(list).getAllByRole('button')[1]).toHaveAttribute('aria-pressed', 'true')
    })

    const rows = within(list).getAllByRole('button')
    // Same rows, same count, same positions.
    expect(rows).toHaveLength(before.length)
    expect(rows[0].textContent).toBe(before[0])
    expect(rows[2].textContent).toBe(before[2])
    // The tapped row is the one that changed, and it turned green.
    expect(rows[1]).toHaveClass('border-state-posted/40')
    expect(within(rows[1]).getByText('filmed')).toBeInTheDocument()
  })

  it('undoes on a second tap', async () => {
    await seedFilmBacklog(1)
    const user = userEvent.setup()
    const list = await startFilmSession(user)

    const count = within(list).getAllByRole('button').length
    const row = () => within(list).getAllByRole('button')[0]

    await user.click(row())
    await waitFor(() => expect(row()).toHaveAttribute('aria-pressed', 'true'))

    await user.click(row())
    await waitFor(() => expect(row()).toHaveAttribute('aria-pressed', 'false'))
    // Still there, still first, and nothing else appeared or vanished.
    expect(within(list).getAllByRole('button')).toHaveLength(count)
  })

  it('never proposes editing in a FILM session', async () => {
    // A second campaign whose only video is waiting to be edited. It has no
    // default setup, so the film-ahead pass cannot generate supply for it and
    // its name can only appear if edit work leaked into the session.
    const other = await adapter.createCampaign({
      name: 'Other campaign',
      company: null,
      default_setup: null,
      approval_mode: 'none',
      pay_per_video_cents: 1000,
      cycle_size: null,
    })
    const toEdit = await adapter.createVideo({
      campaign_id: other.id,
      setup: 'face',
      angle_id: null,
      script: null,
      blocked_reason: null,
      owed_for_date: null,
      rate_snapshot_cents: null,
      posted_at: null,
    })
    await adapter.advanceVideoPhase(toEdit.id, { session: 'film' }) // now 'filmed'

    const user = userEvent.setup()
    const list = await startFilmSession(user)

    // The filmed video belongs to an EDIT session, not this one.
    expect(within(list).queryByText('Other campaign')).toBeNull()
  })
})

describe('choosing a campaign for FILM and EDIT', () => {
  it('shows the do/don\'t briefing before a FILM session starts, and offers to start it', async () => {
    await adapter.addCampaignRule({ campaign_id: INFLOW_CAMPAIGN_ID, body: 'Never say the brand name twice.' })

    const user = userEvent.setup()
    renderScreen(<Now />)
    await screen.findByText(/of 1 posted/)
    await user.click(screen.getByRole('button', { name: 'FILM' }))
    await user.click(screen.getByRole('button', { name: '60' }))
    await user.click(await screen.findByRole('button', { name: /Inflow/ }))

    expect(await screen.findByText('Never say the brand name twice.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start filming' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Start filming' }))
    expect(await screen.findByRole('list', { name: 'Tonight' })).toBeInTheDocument()
  })

  it('shows the editing style he typed himself in an EDIT briefing', async () => {
    await adapter.setCampaignField({
      campaign_id: INFLOW_CAMPAIGN_ID,
      field_key: 'editing_style',
      field_value: 'Fast cuts, no music, captions burned in.',
      source: 'user_entered',
      source_quote: null,
      source_document_id: null,
    })

    const user = userEvent.setup()
    renderScreen(<Now />)
    await screen.findByText(/of 1 posted/)
    await user.click(screen.getByRole('button', { name: 'EDIT' }))
    await user.click(screen.getByRole('button', { name: '60' }))
    await user.click(await screen.findByRole('button', { name: /Inflow/ }))

    expect(await screen.findByText('Fast cuts, no music, captions burned in.')).toBeInTheDocument()
  })

  it('does not offer a campaign whose account has never posted and is still warming up', async () => {
    await adapter.createCampaign({
      name: 'Brand new campaign',
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      pay_per_video_cents: 1000,
      cycle_size: null,
    })

    const user = userEvent.setup()
    renderScreen(<Now />)
    await screen.findByText(/of 1 posted/)
    await user.click(screen.getByRole('button', { name: 'FILM' }))
    await user.click(screen.getByRole('button', { name: '60' }))

    await screen.findByRole('button', { name: /Inflow/ })
    expect(screen.queryByRole('button', { name: /Brand new campaign/ })).toBeNull()
  })
})

describe('warming up an account', () => {
  it('shows the account and a countdown, and records a completed session', async () => {
    const fresh = await adapter.createCampaign({
      name: 'Brand new campaign',
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      pay_per_video_cents: 1000,
      cycle_size: null,
    })
    await adapter.setCampaignField({
      campaign_id: fresh.id,
      field_key: 'handle_tiktok',
      field_value: '@brandnew',
      source: 'user_entered',
      source_quote: null,
      source_document_id: null,
    })

    const user = userEvent.setup()
    renderScreen(<Now />)
    await screen.findByText(/of 1 posted/)
    await user.click(screen.getByRole('button', { name: 'WARM-UP' }))
    await user.click(screen.getByRole('button', { name: '30' }))
    await user.click(await screen.findByRole('button', { name: /Brand new campaign/ }))

    expect(await screen.findByText('TikTok @brandnew')).toBeInTheDocument()
    expect(screen.getByText('30:00')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Mark warmed up' }))

    await waitFor(async () => {
      const events = await adapter.listWarmupEvents({ campaignId: fresh.id })
      expect(events).toHaveLength(1)
      expect(events[0].minutes).toBe(30)
    })
  })

  it('leaves the WARM-UP list once an account has warmed up twice, and offers it in FILM instead', async () => {
    const fresh = await adapter.createCampaign({
      name: 'Brand new campaign',
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      pay_per_video_cents: 1000,
      cycle_size: null,
    })
    await adapter.recordWarmupEvent(fresh.id, 30)
    await adapter.recordWarmupEvent(fresh.id, 30)

    const user = userEvent.setup()
    renderScreen(<Now />)
    await screen.findByText(/of 1 posted/)

    await user.click(screen.getByRole('button', { name: 'WARM-UP' }))
    await user.click(screen.getByRole('button', { name: '30' }))
    await screen.findByText(/nothing needs warming up/i)
    expect(screen.queryByRole('button', { name: /Brand new campaign/ })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Change session' }))
    await user.click(screen.getByRole('button', { name: 'FILM' }))
    await user.click(screen.getByRole('button', { name: '30' }))
    expect(await screen.findByRole('button', { name: /Brand new campaign/ })).toBeInTheDocument()
  })
})

describe('the tick-off list', () => {
  it('lists what is owed today and marks it posted in one tap', async () => {
    const user = userEvent.setup()
    renderScreen(<TickOff />)

    const list = await screen.findByRole('list', { name: 'Owed today' })
    const row = within(list).getAllByRole('button')[0]
    expect(row).toHaveAttribute('aria-pressed', 'false')

    await user.click(row)

    await waitFor(() => {
      expect(within(list).getAllByRole('button')[0]).toHaveAttribute('aria-pressed', 'true')
    })
    expect(within(list).getByText('posted')).toBeInTheDocument()
    expect(screen.getByText('1 of 1 owed today')).toBeInTheDocument()
  })

  it('keeps a ticked-off row in place rather than removing it', async () => {
    const user = userEvent.setup()
    renderScreen(<TickOff />)

    const list = await screen.findByRole('list', { name: 'Owed today' })
    expect(within(list).getAllByRole('button')).toHaveLength(1)

    await user.click(within(list).getAllByRole('button')[0])

    await waitFor(() => {
      expect(within(list).getAllByRole('button')[0]).toHaveAttribute('aria-pressed', 'true')
    })
    // He needs to see what he has done.
    expect(within(list).getAllByRole('button')).toHaveLength(1)
  })
})
