// BRIEFS shows what each campaign pays a month, and lets him correct it.
//
// The figure is an estimate - rate x posts per day x 30 - and for two of his
// campaigns it is simply wrong: Pump.Fun is a monthly retainer and Inflow pays
// per completed 60-post cycle. So it is marked as an estimate until he types
// the real number, and his number is marked as his.

import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import type { Campaign, DataAdapter } from '../data'
import { DataContext } from '../data/context'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { Campaigns } from './Campaigns'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: DataAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`briefs-${crypto.randomUUID()}`)
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

async function renderBriefs() {
  render(
    <DataContext.Provider value={adapter}>
      <MemoryRouter>
        <Campaigns />
      </MemoryRouter>
    </DataContext.Provider>,
  )
  await screen.findByRole('heading', { name: 'Briefs' })
}

describe('pay per month on each brief', () => {
  it('estimates it from the rate and says that it is an estimate', async () => {
    await makeCampaign()
    await renderBriefs()

    // $35 x 1/day x 30.
    expect(await screen.findByText(/~\$1050\.00\/mo · estimate/)).toBeInTheDocument()
  })

  it('says so plainly when there is no rate to estimate from', async () => {
    await makeCampaign({ pay_per_video_cents: null })
    await renderBriefs()

    expect(await screen.findByText('no rate')).toBeInTheDocument()
    expect(screen.getByText(/tap to set pay per month/)).toBeInTheDocument()
  })

  it('takes his own figure and marks it as his', async () => {
    // Pump.Fun: the estimate says $1,499.40 and the retainer is $2,000.
    const user = userEvent.setup()
    await makeCampaign({ name: 'Pump.Fun', pay_per_video_cents: 1666, daily_post_quota: 3 })
    await renderBriefs()

    expect(await screen.findByText(/~\$1499\.40\/mo · estimate/)).toBeInTheDocument()

    await user.click(screen.getByLabelText('Pay per month for Pump.Fun'))
    await user.type(screen.getByLabelText('Pay per month for Pump.Fun'), '2000')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/\$2000\.00\/mo · your figure/)).toBeInTheDocument()
    expect(screen.queryByText(/~\$1499\.40/)).toBeNull()
  })

  it('stores it as integer cents on the campaign', async () => {
    const user = userEvent.setup()
    const campaign = await makeCampaign()
    await renderBriefs()

    await user.click(await screen.findByLabelText('Pay per month for Inflow'))
    await user.type(screen.getByLabelText('Pay per month for Inflow'), '1234.56')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(async () => {
      expect((await adapter.getCampaign(campaign.id))?.monthly_pay_override_cents).toBe(123456)
    })
  })

  it('puts the estimate back when he resets it', async () => {
    const user = userEvent.setup()
    const campaign = await makeCampaign({ monthly_pay_override_cents: 200000 })
    await renderBriefs()

    expect(await screen.findByText(/\$2000\.00\/mo · your figure/)).toBeInTheDocument()

    await user.click(screen.getByLabelText('Pay per month for Inflow'))
    await user.click(screen.getByRole('button', { name: 'Reset' }))

    expect(await screen.findByText(/~\$1050\.00\/mo · estimate/)).toBeInTheDocument()
    // Null, never zero: a campaign he has un-corrected is not one paying
    // nothing.
    expect((await adapter.getCampaign(campaign.id))?.monthly_pay_override_cents).toBeNull()
  })

  it('refuses something that is not an amount rather than storing a guess', async () => {
    const user = userEvent.setup()
    await makeCampaign()
    await renderBriefs()

    await user.click(await screen.findByLabelText('Pay per month for Inflow'))
    await user.type(screen.getByLabelText('Pay per month for Inflow'), 'about two grand')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByText(/Enter an amount/)).toBeInTheDocument()
  })

  it('shows the per-video rate he negotiated, not a daily total', async () => {
    // Pump.Fun pays $16.66 a video, three a day. A per-day figure reads
    // "$49.98/day" and hides the only number he actually agreed.
    await makeCampaign({ name: 'Pump.Fun', pay_per_video_cents: 1666, daily_post_quota: 3 })
    await renderBriefs()

    expect(await screen.findByText(/\$16\.66\/video/)).toBeInTheDocument()
    expect(screen.getByText(/3\/day/)).toBeInTheDocument()
    expect(screen.queryByText(/\$49\.98/)).toBeNull()
  })

  it('still says what it owes a day when there is no rate', async () => {
    await makeCampaign({ pay_per_video_cents: null, daily_post_quota: 2 })
    await renderBriefs()

    expect(await screen.findByText('no rate')).toBeInTheDocument()
    expect(screen.getByText(/2\/day/)).toBeInTheDocument()
  })

  it('offers no reset until there is something to reset', async () => {
    const user = userEvent.setup()
    await makeCampaign()
    await renderBriefs()

    await user.click(await screen.findByLabelText('Pay per month for Inflow'))
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull()
  })
})
