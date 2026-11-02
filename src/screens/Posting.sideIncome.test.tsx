// The detailing / media maxing panel on the Post screen: his only. A student
// who came in through an invite link never sees it.

import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { DataContext } from '../data/context'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { LocalDatabase } from '../data/local/db'
import { Posting } from './Posting'

let owner = true
vi.mock('../sync/owner', () => ({ useIsOwner: () => owner }))

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: LocalAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  localStorage.clear()
  const db = new LocalDatabase(`side-post-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
  const campaign = await adapter.createCampaign({
    name: 'Inflow', company: null, default_setup: 'face', approval_mode: 'none',
    daily_post_quota: 1, pay_per_video_cents: 3500, cycle_size: null,
  })
  await adapter.addCampaignAccount({ campaign_id: campaign.id, platform: 'TikTok', handle: '@me', status: 'ready' })
})

function renderScreen() {
  return render(
    <DataContext.Provider value={adapter}>
      <MemoryRouter>
        <Posting />
      </MemoryRouter>
    </DataContext.Provider>,
  )
}

describe('detailing and media maxing on the Post screen', () => {
  it('lets him add a USD amount and counts it into Made today', async () => {
    owner = true
    const user = userEvent.setup()
    renderScreen()
    await user.click(await screen.findByRole('button', { name: /Add detailing or media maxing/ }))
    await user.click(screen.getByRole('button', { name: 'Media Maxing' }))
    await user.type(screen.getByLabelText('Amount'), '50')
    await user.click(screen.getByRole('button', { name: 'USD' }))
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByText('$50.00 USD')).toBeInTheDocument()
    const [entry] = await adapter.listSideIncome()
    expect([entry.source, entry.amount_cents, entry.currency]).toEqual(['media_maxing', 5000, 'USD'])
    await waitFor(() => expect(screen.getByLabelText('Made today')).toHaveTextContent('$50.00'))
  })

  it('takes a mistaken entry back out', async () => {
    owner = true
    await adapter.addSideIncome({ source: 'detailing', amount_cents: 18000, currency: 'CAD', earned_on: new Date().toLocaleDateString('en-CA') })
    const user = userEvent.setup()
    renderScreen()
    await user.click(await screen.findByRole('button', { name: 'Remove Detailing $180.00 CAD' }))
    await waitFor(async () => expect(await adapter.listSideIncome()).toHaveLength(0))
  })

  it('is not shown to anyone else', async () => {
    owner = false
    renderScreen()
    await screen.findByText('Inflow')
    expect(screen.queryByRole('button', { name: /Add detailing or media maxing/ })).toBeNull()
  })
})
