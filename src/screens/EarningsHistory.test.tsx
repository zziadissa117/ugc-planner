import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Campaign, CampaignAccount, DataAdapter } from '../data'
import { DataContext } from '../data/context'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { buildBoard, markPosted, unmarkPosted } from '../data/posting'
import { EarningsHistory } from './EarningsHistory'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: DataAdapter

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 5, 12, 0, 0))
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`history-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})

afterEach(() => {
  vi.useRealTimers()
})

async function campaignWith(rate: number | null, platforms: string[]) {
  const campaign = await adapter.createCampaign({
    name: 'Pump',
    company: null,
    default_setup: 'face',
    approval_mode: 'none',
    daily_post_quota: 1,
    pay_per_video_cents: rate,
    cycle_size: null,
    pays_per_platform: true,
  })
  const accounts: CampaignAccount[] = []
  for (const platform of platforms) {
    accounts.push(
      await adapter.addCampaignAccount({ campaign_id: campaign.id, platform, handle: '@me', status: 'ready' }),
    )
  }
  return { campaign, accounts }
}

async function tick(campaign: Campaign, account: CampaignAccount) {
  const videos = await adapter.listVideos({ campaignId: campaign.id })
  const posts = (await Promise.all(videos.map((v) => adapter.listVideoPosts(v.id)))).flat()
  const accounts = await adapter.listCampaignAccounts(campaign.id)
  await markPosted(adapter, buildBoard(campaign, accounts, videos, posts), account, 0, videos)
}

function show() {
  render(
    <DataContext.Provider value={adapter}>
      <MemoryRouter>
        <EarningsHistory />
      </MemoryRouter>
    </DataContext.Provider>,
  )
}

describe('the earnings history', () => {
  it('says there is nothing yet, rather than showing $0.00 as a result', async () => {
    show()
    expect(await screen.findByText(/nothing yet/i)).toBeInTheDocument()
  })

  it('totals what was ticked off, by day, week and month', async () => {
    const { campaign, accounts } = await campaignWith(1600, ['TikTok', 'Instagram'])
    await tick(campaign, accounts[0])
    await tick(campaign, accounts[1])
    const user = userEvent.setup()
    show()

    // Two platforms paid separately: $32 so far, and it is today's line.
    expect((await screen.findByText('Total so far')).parentElement).toHaveTextContent('$32.00')
    expect(screen.getByText('Oct 5').parentElement).toHaveTextContent('$32.00')

    await user.click(screen.getByRole('button', { name: 'Week' }))
    expect(screen.getByText('Week of Oct 5').parentElement).toHaveTextContent('$32.00')

    await user.click(screen.getByRole('button', { name: 'Month' }))
    expect(screen.getByText('October 2026').parentElement).toHaveTextContent('$32.00')
  })

  it('shows a taken-back post as its own line and nets the total, never erasing the original', async () => {
    const { campaign, accounts } = await campaignWith(1600, ['TikTok'])
    await tick(campaign, accounts[0])
    const video = (await adapter.listVideos())[0]
    const post = (await adapter.listVideoPosts(video.id))[0]
    await unmarkPosted(adapter, accounts[0], post)
    show()

    expect((await screen.findByText('Total so far')).parentElement).toHaveTextContent('$0.00')
    await waitFor(() => expect(screen.getByText(/· ticked off/)).toBeInTheDocument())
    expect(screen.getByText(/· taken back/)).toBeInTheDocument()
    expect(screen.getByText('+$16.00')).toBeInTheDocument()
    expect(screen.getByText('-$16.00')).toBeInTheDocument()
  })

  it('counts the ticks that earned nothing because no rate was saved, out loud', async () => {
    const { campaign, accounts } = await campaignWith(null, ['TikTok'])
    await tick(campaign, accounts[0])
    show()
    expect(await screen.findByText(/ticked with no rate saved/i)).toBeInTheDocument()
    expect(screen.getByText(/unknown, not zero/i)).toBeInTheDocument()
  })
})
