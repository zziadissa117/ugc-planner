// CAMPAIGNS is every campaign at once, as tiles, in the order he records
// them: the high-quality ones (a minimum number of views) first, the quick
// and easy ones last. A tile says the name, the platforms as logos, what it
// pays a day and - for a high-quality one - the minimum views.
//
// The money sits at the bottom, small: what finishing every post pays a day
// and what the signed contracts come to a month. It used to be a tab.

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
  const db = new LocalDatabase(`campaigns-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})

async function makeCampaign(overrides: Partial<Campaign> = {}) {
  const { min_views, posts_per_week, monthly_pay_override_cents, post_position, ...rest } = overrides
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
  if (post_position !== undefined) patch.post_position = post_position
  if (Object.keys(patch).length > 0) await adapter.updateCampaign(campaign.id, patch)
  return campaign
}

async function addAccount(campaignId: string, platform: string, handle: string | null = '@michael.financier') {
  return adapter.addCampaignAccount({ campaign_id: campaignId, platform, handle, status: 'ready' })
}

async function renderCampaigns() {
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
  await screen.findByRole('heading', { name: 'Your campaigns' })
}

async function tile(name: string) {
  return (await screen.findByRole('heading', { name })).closest('a') as HTMLElement
}

async function tileNames() {
  await screen.findAllByRole('heading', { level: 3 })
  return screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
}

describe('a tile', () => {
  it('shows the name, the pay a day, the minimum views and the platform logos', async () => {
    const campaign = await makeCampaign({ min_views: 1000 })
    await addAccount(campaign.id, 'TikTok')
    await addAccount(campaign.id, 'Instagram')
    await renderCampaigns()

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
    await renderCampaigns()

    const card = await tile('Inflow')
    expect(card.textContent).not.toMatch(/michael\.financier/)
    expect(card.textContent).not.toMatch(/TikTok/)
  })

  it('leaves the minimum off a quick one rather than writing "none"', async () => {
    await makeCampaign({ min_views: null })
    await renderCampaigns()

    const text = (await tile('Inflow')).textContent ?? ''
    expect(text).not.toMatch(/min views/)
  })

  it('pays a day once however many platforms it posts to', async () => {
    const campaign = await makeCampaign()
    await addAccount(campaign.id, 'TikTok')
    await addAccount(campaign.id, 'Instagram')
    await addAccount(campaign.id, 'YouTube')
    await renderCampaigns()

    const card = within(await tile('Inflow'))
    expect(card.getByText('$35.00')).toBeInTheDocument()
    expect(card.queryByText('$105.00')).toBeNull()
  })

  it('agrees with the month he corrected', async () => {
    // A $2,100 retainer is $70 a day, whatever the per-video estimate says.
    await makeCampaign({ monthly_pay_override_cents: 210000 })
    await renderCampaigns()

    expect(within(await tile('Inflow')).getByText('$70.00')).toBeInTheDocument()
  })

  it('says "not saved yet" rather than guessing a rate', async () => {
    await makeCampaign({ pay_per_video_cents: null })
    await renderCampaigns()

    const card = within(await tile('Inflow'))
    expect(card.getByText('not saved yet')).toBeInTheDocument()
    expect(card.queryByText(/\$/)).toBeNull()
  })

  it('says in red when nobody can post from it yet', async () => {
    const empty = await makeCampaign({ name: 'Empty' })
    const blank = await makeCampaign({ name: 'Blank handle' })
    await addAccount(blank.id, 'TikTok', null)
    const ready = await makeCampaign({ name: 'Ready' })
    await addAccount(ready.id, 'TikTok')
    await renderCampaigns()

    for (const name of ['Empty', 'Blank handle']) {
      expect(within(await tile(name)).getByText('add your accounts')).toHaveClass('text-state-blocked')
    }
    expect(within(await tile('Ready')).queryByText('add your accounts')).toBeNull()
    expect(empty.id).not.toBe(ready.id)
  })

  it('leaves out an account he switched off', async () => {
    const campaign = await makeCampaign()
    await addAccount(campaign.id, 'TikTok')
    const youtube = await addAccount(campaign.id, 'YouTube')
    await adapter.updateCampaignAccount(youtube.id, { is_active: false })
    await renderCampaigns()

    expect(within(await tile('Inflow')).getByRole('img', { name: 'TikTok' })).toBeInTheDocument()
  })
})

describe('the order', () => {
  it('puts every high-quality campaign first and the quick ones last', async () => {
    await makeCampaign({ name: 'Quick rich', pay_per_video_cents: 9000, min_views: null })
    await makeCampaign({ name: 'Strict', pay_per_video_cents: 1000, min_views: 10000 })
    await makeCampaign({ name: 'Quick cheap', pay_per_video_cents: 500, min_views: null })
    await makeCampaign({ name: 'Also strict', pay_per_video_cents: 2000, min_views: 500 })
    await renderCampaigns()

    // Best pay first inside each group.
    expect(await tileNames()).toEqual(['Also strict', 'Strict', 'Quick rich', 'Quick cheap'])
    expect(screen.getByText('High quality - record first')).toBeInTheDocument()
    expect(screen.getByText('Quick and easy - last')).toBeInTheDocument()
  })

  it('ignores the order he set on Post - that one is for Post only', async () => {
    await makeCampaign({ name: 'Placed first on Post', min_views: null, post_position: 0 })
    await makeCampaign({ name: 'High quality', min_views: 1000, post_position: 1 })
    await renderCampaigns()

    expect(await tileNames()).toEqual(['High quality', 'Placed first on Post'])
    // And nothing here rewrote his Post order.
    const rows = await adapter.listCampaigns()
    expect(rows.find((c) => c.name === 'Placed first on Post')?.post_position).toBe(0)
  })

  it('shows only the group there is', async () => {
    await makeCampaign({ name: 'Quick', min_views: null })
    await renderCampaigns()

    await tile('Quick')
    expect(screen.queryByText('High quality - record first')).toBeNull()
    expect(screen.getByText('Quick and easy - last')).toBeInTheDocument()
  })
})

describe('the money at the bottom', () => {
  function line(label: string) {
    return screen.getByText(label).closest('div') as HTMLElement
  }

  it('says what finishing every post pays a day, and the signed contracts a month', async () => {
    // $35 x 7 a week and $10 x 14 a week: $35 + $20 a day; a month is 30/7 of a week.
    await makeCampaign({ name: 'Inflow', pay_per_video_cents: 3500, posts_per_week: 7 })
    await makeCampaign({ name: 'Vertus', pay_per_video_cents: 1000, posts_per_week: 14 })
    await renderCampaigns()
    await tile('Inflow')

    expect(line('Finish all your posts')).toHaveTextContent('$55.00 a day')
    expect(line('Signed contracts')).toHaveTextContent('$1650.00 a month')
  })

  it('pays a deliverable once across platforms, and per platform only when the campaign says so', async () => {
    const once = await makeCampaign({ name: 'Once', pay_per_video_cents: 1000 })
    await addAccount(once.id, 'TikTok')
    await addAccount(once.id, 'Instagram')
    const each = await makeCampaign({ name: 'Each', pay_per_video_cents: 1000, pays_per_platform: true })
    await addAccount(each.id, 'TikTok')
    await addAccount(each.id, 'Instagram')
    await renderCampaigns()
    await tile('Once')

    // $10 once + $10 on each of two platforms.
    expect(line('Finish all your posts')).toHaveTextContent('$30.00 a day')
  })

  it('takes his own month as the month', async () => {
    await makeCampaign({ monthly_pay_override_cents: 210000 })
    await renderCampaigns()
    await tile('Inflow')

    expect(line('Signed contracts')).toHaveTextContent('$2100.00 a month')
    expect(line('Finish all your posts')).toHaveTextContent('$70.00 a day')
  })

  it('names a campaign with no rate instead of counting it as zero', async () => {
    await makeCampaign({ name: 'Inflow' })
    await makeCampaign({ name: 'Mystery', pay_per_video_cents: null })
    await renderCampaigns()
    await tile('Mystery')

    expect(line('Finish all your posts')).toHaveTextContent('$35.00 a day')
    expect(screen.getByText(/Mystery has no pay per video saved/)).toBeInTheDocument()
  })

  it('leaves archived campaigns out', async () => {
    await makeCampaign({ name: 'Inflow' })
    const old = await makeCampaign({ name: 'Old', pay_per_video_cents: 9900 })
    await adapter.archiveCampaign(old.id)
    await renderCampaigns()
    await tile('Inflow')

    expect(line('Finish all your posts')).toHaveTextContent('$35.00 a day')
  })

  it('links to the earnings history', async () => {
    await makeCampaign()
    await renderCampaigns()

    expect(await screen.findByRole('link', { name: 'Earnings history' })).toHaveAttribute('href', '/money/history')
  })
})

describe('the whole page', () => {
  it('opens the campaign page when a tile is tapped', async () => {
    const user = userEvent.setup()
    await makeCampaign()
    await renderCampaigns()

    await user.click(await tile('Inflow'))
    expect(await screen.findByText('campaign page')).toBeInTheDocument()
  })

  it('keeps a way to start a campaign and to reach archived ones', async () => {
    const archived = await makeCampaign({ name: 'Old' })
    await adapter.archiveCampaign(archived.id)
    await makeCampaign()
    await renderCampaigns()

    expect(await screen.findByRole('link', { name: 'New campaign' })).toHaveAttribute('href', '/campaigns/new')
    expect(await screen.findByRole('link', { name: 'Archived (1)' })).toHaveAttribute('href', '/campaigns/archived')
  })

  it('with nothing yet, says so and offers the one thing to do', async () => {
    await renderCampaigns()

    expect(await screen.findByText('No campaigns yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New campaign' })).toHaveAttribute('href', '/campaigns/new')
    expect(screen.queryByText('Finish all your posts')).toBeNull()
  })
})
