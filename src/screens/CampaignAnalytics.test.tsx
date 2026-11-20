import 'fake-indexeddb/auto'
import { render, screen } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { DataContext } from '../data/context'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { LocalDatabase } from '../data/local/db'
import { CampaignAnalytics } from './CampaignAnalytics'

const fetchCutterViews = vi.fn()
const listCutterCampaigns = vi.fn()
vi.mock('../sync/cutterViews', () => ({
  fetchCutterViews: (...a: unknown[]) => fetchCutterViews(...a),
  listCutterCampaigns: () => listCutterCampaigns(),
}))

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: LocalAdapter
let campaignId: string

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`analytics-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
  const campaign = await adapter.createCampaign({
    name: 'Login', company: null, default_setup: 'face', approval_mode: 'none',
    daily_post_quota: 1, pay_per_video_cents: 2000, cycle_size: null,
  })
  campaignId = campaign.id
  // His accounts on the campaign - the only ones whose views count.
  await adapter.addCampaignAccount({ campaign_id: campaign.id, platform: 'TikTok', handle: '@login.tt', status: 'ready' })
  await adapter.addCampaignAccount({ campaign_id: campaign.id, platform: 'Instagram', handle: 'login.ig', status: 'ready' })
  listCutterCampaigns.mockResolvedValue([{ id: 'cut-login', name: 'Login' }])
})

function renderScreen() {
  return render(
    <DataContext.Provider value={adapter}>
      <MemoryRouter initialEntries={[`/post/${campaignId}/analytics`]}>
        <Routes>
          <Route path="/post/:campaignId/analytics" element={<CampaignAnalytics />} />
        </Routes>
      </MemoryRouter>
    </DataContext.Provider>,
  )
}

describe('campaign analytics', () => {
  it("shows the month's views and flags an account under 200 in the last 24 hours", async () => {
    const yesterday = new Date(Date.now() - 30 * 3_600_000).toISOString()
    fetchCutterViews.mockResolvedValue([
      {
        id: 'p1',
        postedAt: yesterday,
        accounts: [
          { name: 'Login TT', platform: 'TikTok', profile: 'login.tt' },
          { name: 'Login IG', platform: 'Instagram', profile: 'login.ig' },
        ],
        views: { 'Login TT': 150, 'Login IG': 2400 },
      },
      {
        // Jake's post on the same cutter campaign: left out entirely.
        id: 'jake',
        postedAt: yesterday,
        accounts: [{ name: 'Jake TT', platform: 'TikTok', profile: 'hooksandmike' }],
        views: { 'Jake TT': 90000 },
      },
    ])
    renderScreen()

    expect(await screen.findByText('2,550')).toBeInTheDocument()
    expect(screen.queryByText(/hooksandmike/)).toBeNull()
    expect(fetchCutterViews).toHaveBeenCalledWith('cut-login', expect.any(String))
    expect(screen.getByText('In the past 24 hours, we had less than 200 views for this account.')).toBeInTheDocument()
    // Only the TikTok account is under a line.
    expect(screen.getAllByText(/In the past 24 hours/)).toHaveLength(1)
  })

  it('says so when there is no cutter campaign of that name', async () => {
    listCutterCampaigns.mockResolvedValue([{ id: 'x', name: 'Something else' }])
    renderScreen()
    expect(await screen.findByText(/No cutter campaign called Login/)).toBeInTheDocument()
    expect(fetchCutterViews).not.toHaveBeenCalled()
  })

  it('shows a plain message when the views cannot be read', async () => {
    listCutterCampaigns.mockRejectedValue(new Error('Could not reach the cutter for views. Check the connection and try again.'))
    renderScreen()
    expect(await screen.findByText(/Could not reach the cutter/)).toBeInTheDocument()
  })
})
