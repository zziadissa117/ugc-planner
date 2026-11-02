// BRIEFS is every campaign at once, as tiles, and each tile says only what
// decides whether he needs to make it: the name, what it pays a day, the
// minimum views, and the platforms it goes to as logos.
//
// "I do not need to know anything else." So no month, no week, no per-video
// rate and no handles on a tile - those are one tap away on the campaign page
// (the month correction moved there; see Campaign.test.tsx).

import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import userEvent from '@testing-library/user-event'

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
  const { min_views, posts_per_week, monthly_pay_override_cents, ...rest } = overrides
  const campaign = await adapter.createCampaign({
    name: 'Inflow',
    company: 'Inflowpay',
    default_setup: 'face',
    approval_mode: 'none',
    daily_post_quota: 1,
    pay_per_video_cents: 3500,
    cycle_size: null,
    ...rest,
  })
  const patch: Partial<Campaign> = {}
  if (min_views !== undefined) patch.min_views = min_views
  if (posts_per_week !== undefined) patch.posts_per_week = posts_per_week
  if (monthly_pay_override_cents !== undefined) patch.monthly_pay_override_cents = monthly_pay_override_cents
  if (Object.keys(patch).length > 0) await adapter.updateCampaign(campaign.id, patch)
  return campaign
}

async function addAccount(campaignId: string, platform: string, handle = '@michael.financier') {
  return adapter.addCampaignAccount({ campaign_id: campaignId, platform, handle })
}

async function renderBriefs() {
  render(
    <DataContext.Provider value={adapter}>
      <MemoryRouter initialEntries={['/campaigns']}>
        <Routes>
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/campaigns/:campaignId" element={<p>campaign page</p>} />
        </Routes>
      </MemoryRouter>
    </DataContext.Provider>,
  )
  await screen.findByRole('heading', { name: 'Briefs' })
}

async function tile(name: string) {
  return (await screen.findByRole('heading', { name })).closest('a') as HTMLElement
}

describe('a tile says only what decides whether to make it', () => {
  it('shows the name, the pay a day, the minimum views and the platform logos', async () => {
    const campaign = await makeCampaign({ min_views: 1000 })
    await addAccount(campaign.id, 'TikTok')
    await addAccount(campaign.id, 'Instagram')
    await renderBriefs()

    const card = within(await tile('Inflow'))
    // $35 a post, seven a week: $35 a day.
    expect(card.getByText('$35.00')).toBeInTheDocument()
    expect(card.getByText('per day')).toBeInTheDocument()
    expect(card.getByText('1,000')).toBeInTheDocument()
    expect(card.getByText('min views')).toBeInTheDocument()
    const logos = card.getByRole('img').getAttribute('aria-label')?.split(', ').sort()
    expect(logos).toEqual(['Instagram', 'TikTok'])
  })

  it('shows logos only - no handles, no platform names as text', async () => {
    const campaign = await makeCampaign()
    await addAccount(campaign.id, 'TikTok', '@michael.financier')
    await renderBriefs()

    const card = await tile('Inflow')
    expect(card.textContent).not.toMatch(/michael\.financier/)
    expect(card.textContent).not.toMatch(/TikTok/)
  })

  it('carries nothing else: no month, no week, no per-video rate, no company', async () => {
    await makeCampaign({ name: 'Pump.Fun', pay_per_video_cents: 1666, daily_post_quota: 3 })
    await renderBriefs()

    const text = (await tile('Pump.Fun')).textContent ?? ''
    // $16.66 x 21 a week / 7 = $49.98 a day.
    expect(text).toMatch(/\$49\.98/)
    for (const noise of [/\/mo/, /month/i, /week/i, /\/video/, /\$16\.66/, /Inflowpay/, /estimate/]) {
      expect(text).not.toMatch(noise)
    }
  })

  it('pays a day once however many platforms it posts to', async () => {
    const campaign = await makeCampaign()
    await addAccount(campaign.id, 'TikTok')
    await addAccount(campaign.id, 'Instagram')
    await addAccount(campaign.id, 'YouTube')
    await renderBriefs()

    const card = within(await tile('Inflow'))
    expect(card.getByText('$35.00')).toBeInTheDocument()
    expect(card.queryByText('$105.00')).toBeNull()
  })

  it('agrees with the month he corrected, like the campaign page and MONEY', async () => {
    // A $2,100 retainer is $70 a day, whatever the per-video estimate says.
    await makeCampaign({ monthly_pay_override_cents: 210000 })
    await renderBriefs()

    expect(within(await tile('Inflow')).getByText('$70.00')).toBeInTheDocument()
  })

  it('says "not saved yet" rather than guessing a rate or a minimum', async () => {
    await makeCampaign({ pay_per_video_cents: null })
    await renderBriefs()

    const card = within(await tile('Inflow'))
    expect(card.getAllByText('not saved yet')).toHaveLength(2)
    expect(card.queryByText(/\$/)).toBeNull()
    expect(card.getByText('no accounts yet')).toBeInTheDocument()
  })

  it('leaves out an account he switched off', async () => {
    const campaign = await makeCampaign()
    await addAccount(campaign.id, 'TikTok')
    const youtube = await addAccount(campaign.id, 'YouTube')
    await adapter.updateCampaignAccount(youtube.id, { is_active: false })
    await renderBriefs()

    expect(within(await tile('Inflow')).getByRole('img', { name: 'TikTok' })).toBeInTheDocument()
  })
})

describe('the whole page', () => {
  it('shows every campaign at once, no minimum first, then lowest to highest', async () => {
    await makeCampaign({ name: 'Ten thousand', min_views: 10000 })
    await makeCampaign({ name: 'No minimum', min_views: null })
    await makeCampaign({ name: 'Five hundred', min_views: 500 })
    await makeCampaign({ name: 'One thousand', min_views: 1000 })
    await renderBriefs()

    await screen.findByRole('heading', { name: 'Ten thousand' })
    const names = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(names).toEqual(['No minimum', 'Five hundred', 'One thousand', 'Ten thousand'])
  })

  it('puts the better-paying one first when two share a minimum', async () => {
    await makeCampaign({ name: 'Cheap', pay_per_video_cents: 1000, min_views: 1000 })
    await makeCampaign({ name: 'Unknown', pay_per_video_cents: null, min_views: 1000 })
    await makeCampaign({ name: 'Rich', pay_per_video_cents: 9000, min_views: 1000 })
    await renderBriefs()

    await screen.findByRole('heading', { name: 'Rich' })
    const names = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(names).toEqual(['Rich', 'Cheap', 'Unknown'])
  })

  it('opens the campaign page when a tile is tapped', async () => {
    const user = userEvent.setup()
    await makeCampaign()
    await renderBriefs()

    await user.click(await tile('Inflow'))
    expect(await screen.findByText('campaign page')).toBeInTheDocument()
  })

  it('keeps a way to start a campaign and to reach archived ones', async () => {
    const archived = await makeCampaign({ name: 'Old' })
    await adapter.archiveCampaign(archived.id)
    await makeCampaign()
    await renderBriefs()

    expect(screen.getByRole('link', { name: 'New campaign' })).toHaveAttribute('href', '/campaigns/new')
    expect(await screen.findByRole('link', { name: 'Archived (1)' })).toHaveAttribute('href', '/campaigns/archived')
  })
})
