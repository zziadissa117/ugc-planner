// "Never summed into one figure anywhere in the UI" is a claim about the
// screen, not about the arithmetic, so it gets checked on the screen.

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
import { INFLOW_CAMPAIGN_ID, ensureSeeded } from '../data/seed'
import { Money } from './Money'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: DataAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`money-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
  await ensureSeeded(adapter)
})

async function postVideos(count: number, campaignId = INFLOW_CAMPAIGN_ID) {
  const posted = []
  for (let i = 0; i < count; i++) {
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
    posted.push(await adapter.markVideoPosted(video.id, { session: 'post' }))
  }
  return posted
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
  it('shows what was actually earned, labelled as documented', async () => {
    await postVideos(2)
    await renderMoney()

    expect(screen.getByText('Documented')).toBeInTheDocument()
    // 2 posts at $35.
    expect(screen.getByText('$70.00')).toBeInTheDocument()
  })

  it('does not show bonus columns that could only ever read zero', async () => {
    await postVideos(2)
    await renderMoney()

    // Nothing in the app can enter a bonus probability or a received amount,
    // so both figures were permanently $0.00 - which reads as a fact about his
    // earnings rather than as a missing feature. They come back when there is
    // a way to enter the numbers behind them.
    expect(screen.queryByText('Expected')).toBeNull()
    expect(screen.queryByText('User entered')).toBeNull()
    expect(screen.queryByText(/no odds set yet/i)).toBeNull()
  })

  it('still never sums the figures it does show', async () => {
    await postVideos(2)
    await renderMoney()

    // The rule that outlives the trim: base earned and the cycle position are
    // different kinds of number and are never added together.
    expect(screen.getByText('$70.00')).toBeInTheDocument()
    expect(screen.queryByText('$70.00 total')).toBeNull()
  })

  it('reports the cycle as 13 of 60 with only the carried-over balance', async () => {
    await renderMoney()
    expect(screen.getByText('13 of 60 this cycle')).toBeInTheDocument()
  })

  it('counts the opening balance toward the cycle but not toward earnings', async () => {
    await postVideos(2)
    await renderMoney()

    expect(screen.getByText('15 of 60 this cycle')).toBeInTheDocument()
    // The 13 carried-over posts are their own line with no money attached.
    expect(screen.getByText(/13 posts carried over/)).toBeInTheDocument()
    expect(screen.getByText(/no recorded earnings/)).toBeInTheDocument()
    // 13 x $35 would be $455 of invented history.
    expect(screen.queryByText('$525.00')).toBeNull()
    expect(screen.queryByText('$455.00')).toBeNull()
  })

  it('asks what the carried-over posts were paid at, and values them once told', async () => {
    const user = userEvent.setup()
    await renderMoney()

    // It cannot derive this, but it does not stay quiet about it either.
    const input = screen.getByLabelText(/what were those 13 carried-over posts paid at/i)
    await user.type(input, '35')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(screen.getByText(/13 posts carried over at \$35\.00 each/)).toBeInTheDocument()
    })
    // Its own line inside the DOCUMENTED card, not added to the figure.
    expect(screen.getByText('$455.00')).toBeInTheDocument()
    expect(screen.getByText('Documented').parentElement).toHaveTextContent('$0.00')
  })

  it('does not assume the current rate applies to the carried-over posts', async () => {
    await renderMoney()
    // Inflow pays $35.00 today, and that is not evidence about the old posts.
    expect(screen.getByText(/no recorded earnings/)).toBeInTheDocument()
    expect(screen.queryByText('$455.00')).toBeNull()
  })

  it('says base pay is accrued and not yet payable', async () => {
    await postVideos(1)
    await renderMoney()
    expect(screen.getByText(/not payable until this cycle closes/i)).toBeInTheDocument()
  })
})

describe('posted but unpriced', () => {
  it('counts them separately and keeps them out of the documented figure', async () => {
    const bare = await adapter.createCampaign({
      name: 'Bare',
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      pay_per_video_cents: null,
      cycle_size: null,
    })
    await postVideos(2, bare.id)
    await renderMoney()

    expect(screen.getByText(/2 posted videos have no rate saved/i)).toBeInTheDocument()
    expect(screen.getByText(/their pay is unknown, not zero/i)).toBeInTheDocument()
    // Nothing was counted for them.
    expect(screen.getByText('Documented').parentElement).toHaveTextContent('$0.00')
  })

  it('says a rate is needed before they can be priced', async () => {
    const bare = await adapter.createCampaign({
      name: 'Bare',
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      pay_per_video_cents: null,
      cycle_size: null,
    })
    await postVideos(1, bare.id)
    await renderMoney()

    expect(screen.getByText(/save a rate for this campaign/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /apply/i })).toBeNull()
  })

  it('offers a backfill once a rate exists, and applies it', async () => {
    const bare = await adapter.createCampaign({
      name: 'Bare',
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      pay_per_video_cents: null,
      cycle_size: null,
    })
    const [unpriced] = await postVideos(1, bare.id)

    // A rate arrives by a route that does not itself backfill - the campaign
    // is edited elsewhere, or the row came in from an import.
    await adapter.updateCampaign(bare.id, { pay_per_video_cents: 2500 })
    await adapter.updateVideo(unpriced.id, { rate_snapshot_cents: null })

    const user = userEvent.setup()
    await renderMoney()

    await user.click(screen.getByRole('button', { name: /apply \$25\.00/i }))

    await waitFor(async () => {
      expect((await adapter.getVideo(unpriced.id))?.rate_snapshot_cents).toBe(2500)
    })
    // And the figure picks it up.
    await waitFor(() => {
      expect(screen.getByText('Documented').parentElement).toHaveTextContent('$25.00')
    })
  })
})
