// The money screen shows one thing: what the work pays at his current rates
// and quotas. It counts nothing, so no amount of posting, backlog-clearing or
// platform-adding can move it.

import 'fake-indexeddb/auto'
import { render, screen } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import type { Campaign, DataAdapter } from '../data'
import { DataContext } from '../data/context'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { Money } from './Money'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: DataAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`money-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})

async function makeCampaign(overrides: Partial<Campaign> = {}) {
  return adapter.createCampaign({
    name: 'Inflow',
    company: 'Inflowpay',
    default_setup: 'face',
    approval_mode: 'none',
    daily_post_quota: 1,
    pay_per_video_cents: 3500,
    cycle_size: null,
    ...overrides,
  })
}

async function renderMoney() {
  render(
    <DataContext.Provider value={adapter}>
      <MemoryRouter>
        <Money />
      </MemoryRouter>
    </DataContext.Provider>,
  )
  await screen.findByRole('heading', { name: 'Money' })
}

describe('the money screen', () => {
  it('shows rate times posts per day, per day, week and month', async () => {
    await makeCampaign()
    await renderMoney()

    // $35 x 1/day.
    expect(screen.getAllByText('$35.00').length).toBeGreaterThan(0)
    expect(screen.getByText('$245.00')).toBeInTheDocument()
    expect(screen.getByText('$1050.00')).toBeInTheDocument()
  })

  it('does not multiply by the number of platforms', async () => {
    // The reported bug: $35 a post and one post a day reading as $105/day,
    // because Instagram, TikTok and YouTube were three rows.
    const campaign = await makeCampaign()
    for (const platform of ['Instagram', 'TikTok', 'YouTube']) {
      await adapter.addCampaignAccount({
        campaign_id: campaign.id,
        platform,
        handle: '@michael.financier',
      })
    }
    await renderMoney()

    expect(screen.getAllByText('$35.00').length).toBeGreaterThan(0)
    expect(screen.queryByText('$105.00')).toBeNull()
  })

  it('does not move when a backlog of videos is marked posted', async () => {
    // The other reported bug: thirteen old posts cleared in one sitting
    // reading as $455 earned that day.
    const campaign = await makeCampaign()
    for (let i = 0; i < 13; i++) {
      const video = await adapter.createVideo({
        campaign_id: campaign.id,
        setup: 'face',
        angle_id: null,
        script: null,
        blocked_reason: null,
        owed_for_date: null,
        rate_snapshot_cents: null,
        posted_at: null,
      })
      await adapter.markVideoPosted(video.id, { session: 'post' })
    }
    await renderMoney()

    expect(screen.queryByText('$455.00')).toBeNull()
    expect(screen.getAllByText('$35.00').length).toBeGreaterThan(0)
  })

  it('multiplies by the quota, and only the quota', async () => {
    await makeCampaign({ daily_post_quota: 3 })
    await renderMoney()

    // 3 x $35.
    expect(screen.getAllByText('$105.00').length).toBeGreaterThan(0)
  })

  it('adds campaigns together and names the ones with no rate', async () => {
    await makeCampaign()
    await makeCampaign({ name: 'Vertus', daily_post_quota: 4, pay_per_video_cents: 1000 })
    await makeCampaign({ name: 'Tailgate', pay_per_video_cents: null })
    await renderMoney()

    // $35 + $40.
    expect(screen.getByText('$75.00')).toBeInTheDocument()
    expect(screen.getByText(/One campaign has no rate saved/i)).toBeInTheDocument()
    expect(screen.getAllByText('no rate saved').length).toBeGreaterThan(0)
  })

  it('shows an approximate CAD figure beside each period', async () => {
    await makeCampaign()
    await renderMoney()

    expect(screen.getAllByText(/~\$.*CAD/)).toHaveLength(3)
  })

  it('has none of the old ledger on it', async () => {
    await makeCampaign()
    await renderMoney()

    for (const gone of [/this cycle/i, /opening balance/i, /accrued/i, /carried over/i, /documented/i]) {
      expect(screen.queryByText(gone)).toBeNull()
    }
  })
})
