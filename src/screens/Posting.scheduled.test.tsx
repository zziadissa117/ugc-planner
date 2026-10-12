// Boxes the cutter has scheduled show blue with a clock - "it will go out by
// itself" - until the post goes out and ticks them for real.

import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import type { CutterScheduled } from '../data/cutterBridge'

let scheduled: CutterScheduled[] = []
let cutterCampaigns: { id: string; name: string }[] | null = null
vi.mock('../sync/cutterBridge', async (original) => ({
  ...(await original<typeof import('../sync/cutterBridge')>()),
  useCutterScheduled: () => scheduled,
  listCutterCampaigns: async () => cutterCampaigns,
}))

import { DataContext } from '../data/context'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { LocalDatabase } from '../data/local/db'
import { Posting } from './Posting'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: LocalAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`posting-sched-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
  scheduled = []
  cutterCampaigns = null
})

async function setUp(quota = 2) {
  const campaign = await adapter.createCampaign({
    name: 'Inflow',
    company: null,
    default_setup: 'face',
    approval_mode: 'none',
    daily_post_quota: quota,
    pay_per_video_cents: 3500,
    cycle_size: null,
  })
  await adapter.updateCampaign(campaign.id, { cutter_campaign_id: 'cut-inflow' })
  for (const platform of ['TikTok', 'Instagram']) {
    const account = await adapter.addCampaignAccount({ campaign_id: campaign.id, platform, handle: '@inflow' })
    await adapter.updateCampaignAccount(account.id, { status: 'ready' })
  }
}

const laterToday = () => {
  const at = new Date()
  at.setHours(23, 30, 0, 0)
  return at.toISOString()
}

async function boxes(platform: string) {
  const row = (await screen.findByText(platform)).closest('li')!
  return within(row)
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-label')?.includes('post '))
}

function renderScreen() {
  return render(
    <DataContext.Provider value={adapter}>
      <MemoryRouter>
        <Posting />
      </MemoryRouter>
    </DataContext.Provider>,
  )
}

describe('scheduled in the cutter', () => {
  it('paints as many open boxes blue as the cutter has waiting today, per platform', async () => {
    await setUp(2)
    scheduled = [
      { id: 'p1', campaignId: 'cut-inflow', platforms: ['tiktok'], postAt: laterToday() },
      { id: 'p2', campaignId: 'cut-inflow', platforms: ['tiktok', 'instagram'], postAt: laterToday() },
    ]
    renderScreen()
    const tiktok = await boxes('TikTok')
    expect(tiktok.map((b) => b.getAttribute('aria-label')?.endsWith('- scheduled'))).toEqual([true, true])
    expect(tiktok[0].className).toContain('border-state-scheduled')
    const instagram = await boxes('Instagram')
    expect(instagram.map((b) => b.getAttribute('aria-label')?.endsWith('- scheduled'))).toEqual([true, false])
    // Still a box he can tick by hand.
    expect(instagram[0]).not.toBeDisabled()
  })

  it('ignores posts for another day or an unlinked campaign', async () => {
    await setUp(1)
    const tomorrow = new Date(Date.now() + 36 * 3_600_000).toISOString()
    scheduled = [
      { id: 'p1', campaignId: 'cut-inflow', platforms: ['tiktok'], postAt: tomorrow },
      { id: 'p2', campaignId: 'someone-else', platforms: ['tiktok'], postAt: laterToday() },
    ]
    renderScreen()
    const tiktok = await boxes('TikTok')
    expect(tiktok.some((b) => b.getAttribute('aria-label')?.endsWith('- scheduled'))).toBe(false)
  })
})

describe('linking to the cutter', () => {
  it('suggests a cutter campaign of the same name and links it with one tap', async () => {
    const campaign = await adapter.createCampaign({
      name: 'Inflow',
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      daily_post_quota: 1,
      pay_per_video_cents: 3500,
      cycle_size: null,
    })
    cutterCampaigns = [{ id: 'cut-inflow', name: 'Inflow' }, { id: 'cut-cantina', name: 'Cantina' }]
    scheduled = [{ id: 'p1', campaignId: 'cut-cantina', campaignName: 'Cantina', platforms: ['tiktok'], postAt: laterToday() }]
    const user = userEvent.setup()
    renderScreen()

    expect(await screen.findByText('Link to the Cutter')).toBeInTheDocument()
    expect(screen.getByText(/Scheduled in the Cutter today but not here: Cantina/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Link' }))
    expect((await adapter.getCampaign(campaign.id))!.cutter_campaign_id).toBe('cut-inflow')
    expect(screen.queryByRole('button', { name: 'Link' })).toBeNull()
  })

  it('hides a suggestion he says is not a match', async () => {
    await adapter.createCampaign({
      name: 'Vertus',
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      daily_post_quota: 1,
      pay_per_video_cents: 1000,
      cycle_size: null,
    })
    cutterCampaigns = [{ id: 'cut-vertus', name: 'Vertus' }]
    const user = userEvent.setup()
    renderScreen()
    await user.click(await screen.findByRole('button', { name: 'Not this' }))
    expect(screen.queryByText('Link to the Cutter')).toBeNull()
  })

  it('shows nothing to someone the bridge is off for', async () => {
    await setUp(1)
    renderScreen()
    await boxes('TikTok')
    expect(screen.queryByText('Link to the Cutter')).toBeNull()
  })
})
