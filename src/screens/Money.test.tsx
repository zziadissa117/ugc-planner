// He asked for this screen to stop being a ledger: no cycle tracking, no
// opening balance, no "accrued" language - just what posting has actually
// paid today, this week and this month, in both his own currency and an
// approximate CAD conversion "to motivate me".

import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import type { DataAdapter } from '../data'
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

async function makeCampaign(rateCents: number | null = 3500) {
  return adapter.createCampaign({
    name: 'Inflow',
    company: 'Inflowpay',
    default_setup: 'face',
    approval_mode: 'none',
    pay_per_video_cents: rateCents,
    cycle_size: null,
  })
}

async function postVideo(campaignId: string) {
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
  return adapter.markVideoPosted(video.id, { session: 'post' })
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
  it('counts a video posted just now under today, this week and this month', async () => {
    const campaign = await makeCampaign()
    await postVideo(campaign.id)
    await renderMoney()

    // $35, three times over - today, week and month all include right now.
    expect(screen.getAllByText('$35.00')).toHaveLength(2 * 3) // overall row + the campaign's own row
  })

  it('shows an approximate CAD figure next to each overall period', async () => {
    const campaign = await makeCampaign()
    await postVideo(campaign.id)
    await renderMoney()

    expect(screen.getAllByText(/~\$.*CAD/)).toHaveLength(3)
  })

  it('does not show cycle tracking or an opening balance any more', async () => {
    const campaign = await makeCampaign()
    await postVideo(campaign.id)
    await renderMoney()

    expect(screen.queryByText(/this cycle/i)).toBeNull()
    expect(screen.queryByText(/opening balance/i)).toBeNull()
    expect(screen.queryByText(/accrued/i)).toBeNull()
    expect(screen.queryByText(/carried over/i)).toBeNull()
  })

  it('flags a posted video with no rate saved instead of counting it as zero', async () => {
    const bare = await makeCampaign(null)
    await postVideo(bare.id)
    await renderMoney()

    expect(screen.getByText(/1 posted video has no rate saved/i)).toBeInTheDocument()
    expect(screen.getByText(/their pay is unknown, not zero/i)).toBeInTheDocument()
  })

  it('offers a backfill once a rate exists, and applies it', async () => {
    const bare = await makeCampaign(null)
    const unpriced = await postVideo(bare.id)

    // A rate arrives by a route that does not itself backfill - the campaign
    // is edited elsewhere, or the row came in from an import. Setting the
    // rate directly would auto-backfill within the same write, so the video
    // is put back to unpriced to simulate that.
    await adapter.updateCampaign(bare.id, { pay_per_video_cents: 2500 })
    await adapter.updateVideo(unpriced.id, { rate_snapshot_cents: null })

    const user = userEvent.setup()
    await renderMoney()

    await user.click(screen.getByRole('button', { name: /apply \$25\.00/i }))

    await waitFor(async () => {
      expect((await adapter.getVideo(unpriced.id))?.rate_snapshot_cents).toBe(2500)
    })
    await waitFor(() => {
      expect(screen.getAllByText('$25.00').length).toBeGreaterThan(0)
    })
  })

  it('says a rate is needed before an unpriced video can be backfilled', async () => {
    const bare = await makeCampaign(null)
    await postVideo(bare.id)
    await renderMoney()

    expect(screen.getByText(/save a rate for this campaign/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /apply/i })).toBeNull()
  })
})
