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
import { ensureTodaysQuota } from '../data/today'
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
      <MemoryRouter>{element}</MemoryRouter>
    </DataContext.Provider>,
  )
}

/** Picks FILM and a 60 minute window. Does not assume the list is non-empty:
 *  when a session has nothing at its stage there is no list to find. */
async function openFilmSession(user: ReturnType<typeof userEvent.setup>) {
  renderScreen(<Now />)
  await screen.findByText(/of 1 posted/)
  await user.click(screen.getByRole('button', { name: 'FILM' }))
  await user.click(screen.getByRole('button', { name: '60' }))
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

  it('scopes a FILM session to videos needing filming', async () => {
    await seedFilmBacklog(2)
    const user = userEvent.setup()
    const list = await startFilmSession(user)

    // Today's quota video plus the two built ahead.
    expect(within(list).getAllByRole('button')).toHaveLength(3)
  })

  it('marks a video done in one tap, turns it green, and leaves it in place', async () => {
    await seedFilmBacklog(2)
    const user = userEvent.setup()
    const list = await startFilmSession(user)

    const before = within(list)
      .getAllByRole('button')
      .map((button) => button.textContent)
    expect(before).toHaveLength(3)

    // Tap the middle row - the most disruptive one to move.
    const target = within(list).getAllByRole('button')[1]
    expect(target).toHaveAttribute('aria-pressed', 'false')
    await user.click(target)

    await waitFor(() => {
      expect(within(list).getAllByRole('button')[1]).toHaveAttribute('aria-pressed', 'true')
    })

    const rows = within(list).getAllByRole('button')
    // Still three rows, still in the same positions.
    expect(rows).toHaveLength(3)
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

    const row = () => within(list).getAllByRole('button')[0]
    await user.click(row())
    await waitFor(() => expect(row()).toHaveAttribute('aria-pressed', 'true'))

    await user.click(row())
    await waitFor(() => expect(row()).toHaveAttribute('aria-pressed', 'false'))
    // Still there, still first.
    expect(within(list).getAllByRole('button')).toHaveLength(2)
  })

  it('never proposes editing in a FILM session', async () => {
    await ensureTodaysQuota(adapter)
    const [video] = await adapter.listVideos()
    await adapter.advanceVideoPhase(video.id, { session: 'film' }) // now 'filmed'

    const user = userEvent.setup()
    await openFilmSession(user)

    // The filmed video belongs to an EDIT session, not this one, so a FILM
    // session has nothing to show rather than quietly offering edit work.
    expect(await screen.findByText(/nothing at this stage right now/i)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Tonight' })).toBeNull()
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
