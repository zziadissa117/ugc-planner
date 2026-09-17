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

/** A campaign that counts. MONEY only totals campaigns with an account he can
 *  actually post from, so the default fixture has one. It is on Facebook
 *  because the platform-count test below adds Instagram, TikTok and YouTube
 *  itself, and an account is unique per campaign and platform. */
async function makeCampaign(overrides: Partial<Campaign> = {}) {
  const created = await adapter.createCampaign({
    name: 'Inflow',
    company: 'Inflowpay',
    default_setup: 'face',
    approval_mode: 'none',
    daily_post_quota: 1,
    pay_per_video_cents: 3500,
    cycle_size: null,
    ...overrides,
  })
  await adapter.addCampaignAccount({
    campaign_id: created.id,
    platform: 'Facebook',
    handle: '@michael.financier',
    status: 'ready',
  })
  return created
}

/** A campaign nobody can post from yet: accounts exist, none of them ready.
 *  Lock in App's real numbers - $17.85 a post, one a day, two New accounts. */
async function makeBlockedCampaign(overrides: Partial<Campaign> = {}) {
  const created = await adapter.createCampaign({
    name: 'Lock in App',
    company: null,
    default_setup: 'face',
    approval_mode: 'none',
    daily_post_quota: 1,
    pay_per_video_cents: 1785,
    cycle_size: null,
    ...overrides,
  })
  for (const platform of ['Instagram', 'TikTok']) {
    await adapter.addCampaignAccount({
      campaign_id: created.id,
      platform,
      handle: null,
      status: 'new',
    })
  }
  return created
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


describe('campaigns without a ready account', () => {
  it('keeps them out of the total', async () => {
    await makeCampaign()
    await makeBlockedCampaign()
    await renderMoney()

    // Inflow only: $35 x 1 x 30. Lock in App's $535.50 is not in the total,
    // it is in what he could make.
    expect(screen.getByText('$1050.00')).toBeInTheDocument()
    expect(screen.getAllByText('Could make')).toHaveLength(3)
  })

  it('says on the campaign what finishing onboarding would be worth', async () => {
    await makeCampaign()
    await makeBlockedCampaign()
    await renderMoney()

    expect(screen.getByText(/once an account is ready/)).toHaveTextContent('$535.50')
    expect(screen.getByText(/2 accounts still New/)).toBeInTheDocument()
  })

  it('names the real statuses rather than saying not ready', async () => {
    const blocked = await makeBlockedCampaign()
    const accounts = await adapter.listCampaignAccounts(blocked.id)
    await adapter.updateCampaignAccount(accounts[0].id, { status: 'warming' })
    await renderMoney()

    expect(screen.getByText(/1 New, 1 Warming/)).toBeInTheDocument()
  })

  it('counts it as soon as one account is ready', async () => {
    const blocked = await makeBlockedCampaign()
    const accounts = await adapter.listCampaignAccounts(blocked.id)
    await adapter.updateCampaignAccount(accounts[0].id, { status: 'ready' })
    await renderMoney()

    expect(screen.getByText('$535.50')).toBeInTheDocument()
    expect(screen.queryByText(/once an account is ready/)).toBeNull()
  })

  it('ignores a ready account that is switched off', async () => {
    const blocked = await makeBlockedCampaign()
    const accounts = await adapter.listCampaignAccounts(blocked.id)
    await adapter.updateCampaignAccount(accounts[0].id, { status: 'ready', is_active: false })
    await renderMoney()

    expect(screen.getByText(/once an account is ready/)).toBeInTheDocument()
  })
})

describe('what he could make', () => {
  it('shows the finished figure, not the gap', async () => {
    // His own words: if he makes 100 and could make 100 more, show 200.
    // Inflow $35/day plus Lock in App $17.85/day = $52.85, and so on up.
    await makeCampaign()
    await makeBlockedCampaign()
    await renderMoney()

    expect(screen.getAllByText('Could make')).toHaveLength(3)
    expect(screen.getByText('$52.85')).toBeInTheDocument()
    expect(screen.getByText('$369.95')).toBeInTheDocument()
    expect(screen.getByText('$1585.50')).toBeInTheDocument()
  })

  it('never shows the gap on its own', async () => {
    // The old version put "+$535.50" on each card, which is the difference
    // rather than the number he wanted to look at.
    await makeCampaign()
    await makeBlockedCampaign()
    await renderMoney()

    expect(screen.queryByText('+$535.50')).toBeNull()
    expect(screen.queryByText('Could be')).toBeNull()
  })

  it('says nothing when every campaign is already counting', async () => {
    // A row reading the same as the totals above it would be noise.
    await makeCampaign()
    await renderMoney()

    expect(screen.queryByText('Could make')).toBeNull()
  })

  it('stops showing it once the campaign is ready', async () => {
    const blocked = await makeBlockedCampaign()
    const accounts = await adapter.listCampaignAccounts(blocked.id)
    await adapter.updateCampaignAccount(accounts[0].id, { status: 'ready' })
    await renderMoney()

    expect(screen.queryByText('Could make')).toBeNull()
  })
})

describe('his own monthly figure', () => {
  it('replaces the estimate in the total', async () => {
    // Pump.Fun is a retainer: the estimate says $1,499.40, he is paid $2,000.
    await makeCampaign({
      name: 'Pump.Fun',
      pay_per_video_cents: 1666,
      daily_post_quota: 3,
      monthly_pay_override_cents: 200000,
    })
    await renderMoney()

    expect(screen.getByText('$2000.00')).toBeInTheDocument()
    expect(screen.queryByText('$1499.40')).toBeNull()
  })
})
