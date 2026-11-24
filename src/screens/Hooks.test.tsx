// HOOKS: the one place TODAY's "Hook generation" button opens. Pick the
// campaign; its ideas box and hook list are the campaign page's own.

import 'fake-indexeddb/auto'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { DataContext } from '../data/context'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { INFLOW_CAMPAIGN_ID, ensureSeeded } from '../data/seed'
import { Hooks } from './Hooks'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: LocalAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`hooks-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})

function renderScreen() {
  return render(
    <DataContext.Provider value={adapter}>
      <MemoryRouter>
        <Hooks />
      </MemoryRouter>
    </DataContext.Provider>,
  )
}

describe('hook generation', () => {
  it('says there is nothing to write hooks for without a campaign', async () => {
    renderScreen()
    expect(await screen.findByText('No campaigns yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add a campaign' })).toHaveAttribute('href', '/campaigns/new')
  })

  it("opens on a campaign's ideas and hooks, and switches campaign from the pills", async () => {
    await ensureSeeded(adapter)
    const second = await adapter.createCampaign({ name: 'Second one' } as Parameters<typeof adapter.createCampaign>[0])
    const user = userEvent.setup()
    renderScreen()
    expect(await screen.findByRole('heading', { name: 'Hook generation' })).toBeInTheDocument()
    expect(await screen.findByText('Product & hook ideas')).toBeInTheDocument()
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.length).toBe(2)
    await user.click(screen.getByRole('tab', { name: 'Second one' }))
    expect(screen.getByRole('tab', { name: 'Second one' })).toHaveAttribute('aria-selected', 'true')
    expect(INFLOW_CAMPAIGN_ID).not.toBe(second.id)
  })
})
