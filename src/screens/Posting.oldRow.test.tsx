// The Post tab must not crash on a campaign row that is missing a newer
// column. It did: `min_views === null` read an undefined minimum as a value
// and formatting it threw, and React Router replaced every tab with its
// developer page. The store fills such rows now (v10, completeRow), and the
// screen itself no longer trips on one either.

import 'fake-indexeddb/auto'
import { render, screen } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { DataContext } from '../data/context'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { LocalDatabase } from '../data/local/db'
import { Posting } from './Posting'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: LocalAdapter
let db: LocalDatabase

beforeEach(async () => {
  indexedDB = new IDBFactory()
  db = new LocalDatabase(`posting-old-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})

describe('a campaign row with min_views missing altogether', () => {
  it('still renders its board', async () => {
    const campaign = await adapter.createCampaign({
      name: 'Cantina', company: null, default_setup: 'face', approval_mode: 'none',
      daily_post_quota: 1, pay_per_video_cents: 1250, cycle_size: null,
    })
    const account = await adapter.addCampaignAccount({ campaign_id: campaign.id, platform: 'TikTok', handle: 'hooksandmike' })
    await adapter.updateCampaignAccount(account.id, { status: 'ready' })
    // Straight into the store, past the adapter, as an old build left it.
    const raw = (await db.campaigns.get(campaign.id)) as unknown as Record<string, unknown>
    delete raw.min_views
    delete raw.archived_at
    await db.campaigns.put(raw as never)

    render(
      <DataContext.Provider value={adapter}>
        <MemoryRouter>
          <Posting />
        </MemoryRouter>
      </DataContext.Provider>,
    )
    expect(await screen.findByRole('heading', { name: 'Cantina' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /TikTok post 1 of 1/ })).toBeInTheDocument()
  })
})
