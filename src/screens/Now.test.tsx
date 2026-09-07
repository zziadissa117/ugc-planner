// The home screen: the day's count, one tap to mark something edited, and the
// way into filming. The planner, the session chooser, the window picker, the
// EDIT console and the POST session are all gone; what is tested here is what
// is left.

import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { DataContext } from '../data/context'
import type { DataAdapter } from '../data/DataAdapter'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { INFLOW_CAMPAIGN_ID, ensureSeeded } from '../data/seed'
import { Now } from './Now'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: DataAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`now-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
  await ensureSeeded(adapter)
})

function renderScreen() {
  return render(
    <DataContext.Provider value={adapter}>
      <MemoryRouter>
        <Now />
      </MemoryRouter>
    </DataContext.Provider>,
  )
}

async function filmOne(campaignId = INFLOW_CAMPAIGN_ID) {
  const video = await adapter.createVideo({
    campaign_id: campaignId,
    setup: 'face',
    angle_id: null,
    script: null,
    blocked_reason: null,
    owed_for_date: null,
    rate_snapshot_cents: null,
    posted_at: null,
  })
  await adapter.advanceVideoPhase(video.id, { session: 'film' })
  return video
}

describe('the home screen', () => {
  it('shows the day against what is owed, not against what was filmed', async () => {
    renderScreen()
    // Inflow's seed owes one a day, and nothing has gone out.
    expect(await screen.findByText(/of 1/)).toBeInTheDocument()
    expect(screen.getByText(/posted today/)).toBeInTheDocument()
  })

  it('offers FILM and POST, and nothing that plans an evening', async () => {
    renderScreen()
    await screen.findByText(/of 1/)

    expect(screen.getByRole('button', { name: 'FILM' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'POST' })).toBeInTheDocument()
    for (const gone of ['EDIT', 'WARM-UP', 'Or plan it for me']) {
      expect(screen.queryByRole('button', { name: gone })).toBeNull()
    }
    expect(screen.queryByText(/how long tonight/i)).toBeNull()
    expect(screen.queryByRole('link', { name: /tick them off/i })).toBeNull()
  })

  it('counts a deliverable once however many platforms it went out on', async () => {
    // The bug this replaces: three platforms reading as three posts, and a
    // backlog of phase changes reading as a day's work.
    // The seed gives Inflow TikTok and Instagram; YouTube is the third.
    await adapter.addCampaignAccount({
      campaign_id: INFLOW_CAMPAIGN_ID,
      platform: 'YouTube',
      handle: '@michael.financier',
    })
    const accounts = await adapter.listCampaignAccounts(INFLOW_CAMPAIGN_ID)
    const video = await filmOne()
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

    renderScreen()
    expect(await screen.findByText('1')).toBeInTheDocument()
    expect(screen.getByText(/of 1$/)).toBeInTheDocument()
  })
})

describe('editing, without a session', () => {
  it('shows nothing to edit when nothing has been filmed', async () => {
    renderScreen()
    await screen.findByText(/of 1/)
    expect(screen.queryByText(/ready to edit/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mark edited' })).toBeNull()
  })

  it('marks the oldest filmed video edited in one tap, no goal or timer involved', async () => {
    const video = await filmOne()

    const user = userEvent.setup()
    renderScreen()
    await screen.findByText(/of 1/)

    expect(await screen.findByText('1 filmed, ready to edit')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mark edited' }))

    await waitFor(async () => {
      expect((await adapter.getVideo(video.id))?.phase).toBe('edited')
    })
    await waitFor(() => {
      expect(screen.queryByText(/ready to edit/)).toBeNull()
    })
  })
})

describe('filming against a goal', () => {
  it('shows the never-do list, then counts filmed videos off the goal', async () => {
    await adapter.addCampaignRule({
      campaign_id: INFLOW_CAMPAIGN_ID,
      body: 'Never say the brand name twice.',
    })

    const user = userEvent.setup()
    renderScreen()
    await screen.findByText(/of 1/)

    await user.click(screen.getByRole('button', { name: 'FILM' }))
    await user.click(await screen.findByRole('button', { name: /Inflow/ }))

    expect(await screen.findByText('Never say the brand name twice.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start filming' }))

    // Seven is the default, and there is no clock beside it.
    expect(await screen.findByText('of 7')).toBeInTheDocument()
    expect(screen.queryByLabelText('Elapsed')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Filmed one' }))
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())
  })

  it('lets him set his own goal rather than taking the preset', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText(/of 1/)

    await user.click(screen.getByRole('button', { name: 'FILM' }))
    await user.click(await screen.findByRole('button', { name: /Inflow/ }))
    await user.type(await screen.findByLabelText('or type a number'), '4')
    await user.click(screen.getByRole('button', { name: 'Start filming' }))

    expect(await screen.findByText('of 4')).toBeInTheDocument()
  })

  it('offers a campaign whose accounts are still warming up', async () => {
    // Warm-up is a caution about posting, never a reason to refuse to let him
    // film. The old screen hid the campaign entirely.
    const fresh = await adapter.createCampaign({
      name: 'Brand new campaign',
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      pay_per_video_cents: 1000,
      cycle_size: null,
    })
    await adapter.addCampaignAccount({
      campaign_id: fresh.id,
      platform: 'TikTok',
      handle: '@brandnew',
    })

    const user = userEvent.setup()
    renderScreen()
    await screen.findByText(/of 1/)
    await user.click(screen.getByRole('button', { name: 'FILM' }))

    expect(await screen.findByRole('button', { name: /Brand new campaign/ })).toBeInTheDocument()
  })
})

describe('warming up an account', () => {
  async function freshAccount(platform = 'TikTok', handle = '@brandnew') {
    const campaign = await adapter.createCampaign({
      name: 'Brand new campaign',
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      pay_per_video_cents: 1000,
      cycle_size: null,
    })
    const account = await adapter.addCampaignAccount({
      campaign_id: campaign.id,
      platform,
      handle,
    })
    return { campaign, account }
  }

  it('only appears when something actually needs warming up', async () => {
    renderScreen()
    await screen.findByText(/of 1/)
    // The seed's accounts are ready, so there is nothing to offer.
    expect(screen.queryByRole('button', { name: /Warm up/ })).toBeNull()

    await freshAccount()
    renderScreen()
    expect(await screen.findByRole('button', { name: /Warm up 1 account/ })).toBeInTheDocument()
  })

  it('shows the account and a countdown, and records a completed session', async () => {
    const { account } = await freshAccount()

    const user = userEvent.setup()
    renderScreen()
    await screen.findByText(/of 1/)
    await user.click(await screen.findByRole('button', { name: /Warm up/ }))
    await user.click(await screen.findByRole('button', { name: /TikTok/ }))

    expect(await screen.findByText('@brandnew')).toBeInTheDocument()
    expect(screen.getByText('15:00')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Mark warmed up' }))

    await waitFor(async () => {
      const events = await adapter.listWarmupEvents()
      expect(events.filter((e) => e.account_id === account.id)).toHaveLength(1)
    })
  })

  it('promotes an account to ready after two sessions, and drops it off the list', async () => {
    const { account } = await freshAccount()

    const status = async () =>
      (await adapter.listCampaignAccounts()).find((a) => a.id === account.id)?.status

    await adapter.recordWarmupEvent(account.id, 15)
    expect(await status()).toBe('warming')

    await adapter.recordWarmupEvent(account.id, 15)
    expect(await status()).toBe('ready')

    renderScreen()
    await screen.findByText(/of 1/)
    expect(screen.queryByRole('button', { name: /Warm up/ })).toBeNull()
  })

  it('never demotes an account he marked ready himself', async () => {
    const { account } = await freshAccount()
    await adapter.updateCampaignAccount(account.id, { status: 'ready' })

    await adapter.recordWarmupEvent(account.id, 15)

    const accounts = await adapter.listCampaignAccounts()
    expect(accounts.find((a) => a.id === account.id)?.status).toBe('ready')
  })
})
