// SHOOT is defined as much by what is not on it as by what is. These check
// both: the script round-trips paste box to teleprompter, the primary button
// says what this session actually does, and none of the things SPEC section 5
// rules out have crept in.

import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DataContext } from '../data/context'
import type { DataAdapter, SessionType, Video } from '../data'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { INFLOW_CAMPAIGN_ID, ensureSeeded } from '../data/seed'
import { ensureTodaysQuota } from '../data/today'
import { SessionContext, type ActiveSession } from '../session/SessionContext'
import { Shoot } from './Shoot'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: DataAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`shoot-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
  await ensureSeeded(adapter)
  await ensureTodaysQuota(adapter)
})

const controls = {
  start: vi.fn(),
  goTo: vi.fn(),
  skip: vi.fn(),
  stop: vi.fn(),
}

async function renderShoot(type: SessionType = 'film', videos?: Video[]) {
  const rows = videos ?? (await adapter.listVideos())
  const active: ActiveSession = {
    type,
    windowMinutes: 60,
    videoIds: rows.map((v) => v.id),
    index: 0,
  }

  render(
    <DataContext.Provider value={adapter}>
      <SessionContext.Provider value={{ active, ...controls }}>
        <MemoryRouter>
          <Shoot />
        </MemoryRouter>
      </SessionContext.Provider>
    </DataContext.Provider>,
  )

  await screen.findByRole('heading', { name: 'Inflow' })
  return { active, rows }
}

describe('the SHOOT screen', () => {
  it('shows the campaign and its rate', async () => {
    await renderShoot()
    expect(screen.getByRole('heading', { name: 'Inflow' })).toBeInTheDocument()
    expect(screen.getByText('$35.00')).toBeInTheDocument()
  })

  it('shows progress dots for where he is in tonight list', async () => {
    const { rows } = await renderShoot()
    expect(screen.getByLabelText(`Video 1 of ${rows.length}`)).toBeInTheDocument()
  })

  it('opens into a paste box when the video has no script', async () => {
    await renderShoot()
    expect(screen.getByRole('textbox', { name: 'Script' })).toBeInTheDocument()
  })

  it('saves a pasted script and re-renders it teleprompter-style', async () => {
    const user = userEvent.setup()
    const { rows } = await renderShoot()

    const script = 'A good month looks like fraud to an algorithm.'
    await user.type(screen.getByRole('textbox', { name: 'Script' }), script)
    await user.click(screen.getByRole('button', { name: 'Save script' }))

    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'Script' })).toBeNull()
    })
    expect(screen.getByText(script)).toBeInTheDocument()

    // And it is on the video, not just on the screen.
    const saved = await adapter.getVideo(rows[0].id)
    expect(saved?.script).toBe(script)
  })

  it('lets him get back to the paste box to fix a script', async () => {
    const user = userEvent.setup()
    const { rows } = await renderShoot()
    await adapter.updateVideo(rows[0].id, { script: 'first draft' })

    await user.type(screen.getByRole('textbox', { name: 'Script' }), 'second draft')
    await user.click(screen.getByRole('button', { name: 'Save script' }))
    await waitFor(() => expect(screen.getByText(/second draft/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Edit script' }))
    expect(screen.getByRole('textbox', { name: 'Script' })).toBeInTheDocument()
  })

  it('labels the primary button for the session type', async () => {
    for (const [type, label] of [
      ['film', 'FILMED IT'],
      ['edit', 'EDITED IT'],
      ['post', 'POSTED IT'],
    ] as const) {
      const rows = await adapter.listVideos()
      const { unmount } = render(
        <DataContext.Provider value={adapter}>
          <SessionContext.Provider
            value={{
              active: { type, windowMinutes: 60, videoIds: rows.map((v) => v.id), index: 0 },
              ...controls,
            }}
          >
            <MemoryRouter>
              <Shoot />
            </MemoryRouter>
          </SessionContext.Provider>
        </DataContext.Provider>,
      )
      expect(await screen.findByRole('button', { name: label })).toBeInTheDocument()
      unmount()
    }
  })

  it('advances the video and moves on when the primary button is tapped', async () => {
    const user = userEvent.setup()
    const { rows } = await renderShoot('film')
    controls.skip.mockClear()

    await user.click(screen.getByRole('button', { name: 'FILMED IT' }))

    await waitFor(async () => {
      expect((await adapter.getVideo(rows[0].id))?.phase).toBe('filmed')
    })
    // Straight on to the next one rather than asking what to do next.
    expect(controls.skip).toHaveBeenCalled()
  })

  it('offers exactly the four small actions', async () => {
    await renderShoot()
    for (const label of ['copy for chatgpt', 'skip', 'stop']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: 'read brief' })).toBeInTheDocument()
  })

  it('links read brief to this campaign', async () => {
    await renderShoot()
    expect(screen.getByRole('link', { name: 'read brief' })).toHaveAttribute(
      'href',
      `/campaigns/${INFLOW_CAMPAIGN_ID}`,
    )
  })

  it('shows none of what SPEC section 5 rules out', async () => {
    await renderShoot()
    const page = document.body.textContent ?? ''

    // No phase diagrams, no difficulty ratings, no take counters, no stats.
    expect(page).not.toMatch(/to_film|awaiting_|submitted|approved/i)
    expect(page).not.toMatch(/difficulty|take \d|takes\b/i)
    expect(page).not.toMatch(/average|streak|total videos/i)
  })

  it('says so plainly when there is no session running', async () => {
    render(
      <DataContext.Provider value={adapter}>
        <SessionContext.Provider value={{ active: null, ...controls }}>
          <MemoryRouter>
            <Shoot />
          </MemoryRouter>
        </SessionContext.Provider>
      </DataContext.Provider>,
    )
    expect(await screen.findByText(/no session running/i)).toBeInTheDocument()
  })
})

describe('copy for ChatGPT', () => {
  it('puts the block on the clipboard', async () => {
    const user = userEvent.setup()

    // jsdom exposes navigator.clipboard as a getter, so it has to be redefined
    // rather than assigned - and after userEvent.setup(), which installs a
    // clipboard stub of its own that would otherwise replace this one.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    await renderShoot()
    await user.click(screen.getByRole('button', { name: 'copy for chatgpt' }))

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(writeText.mock.calls[0][0]).toContain('CAMPAIGN: Inflow (Inflowpay)')
    expect(screen.getByText('Copied.')).toBeInTheDocument()
  })

  it('shows the rate as unsaved rather than as zero', async () => {
    const bare = await adapter.createCampaign({
      name: 'Bare',
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      pay_per_video_cents: null,
      cycle_size: null,
    })
    const video = await adapter.createVideo({
      campaign_id: bare.id,
      setup: 'face',
      angle_id: null,
      script: null,
      blocked_reason: null,
      owed_for_date: null,
      rate_snapshot_cents: null,
      posted_at: null,
    })

    render(
      <DataContext.Provider value={adapter}>
        <SessionContext.Provider
          value={{
            active: { type: 'film', windowMinutes: 60, videoIds: [video.id], index: 0 },
            ...controls,
          }}
        >
          <MemoryRouter>
            <Shoot />
          </MemoryRouter>
        </SessionContext.Provider>
      </DataContext.Provider>,
    )

    await screen.findByRole('heading', { name: 'Bare' })
    expect(screen.getByText('no rate yet')).toBeInTheDocument()
  })
})
