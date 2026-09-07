// The posting checklist.
//
// The rule worth pinning: one video goes to every account and is still ONE
// deliverable, so ticking the LAST account is what marks it posted and
// snapshots the rate. Marking it on the first would count money as earned
// before the work was done.

import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { DataContext } from '../data/context'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { LocalDatabase } from '../data/local/db'
import type { Campaign, CampaignAccount } from '../data'
import { Posting } from './Posting'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: LocalAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`posting-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})

async function setUp(): Promise<{ campaign: Campaign; accounts: CampaignAccount[] }> {
  const campaign = await adapter.createCampaign({
    name: 'Inflow',
    company: 'Inflowpay',
    default_setup: 'face',
    approval_mode: 'none',
    daily_post_quota: 1,
    pay_per_video_cents: 3500,
    cycle_size: null,
  })

  const accounts: CampaignAccount[] = []
  for (const platform of ['TikTok', 'Instagram']) {
    const account = await adapter.addCampaignAccount({
      campaign_id: campaign.id,
      platform,
      handle: '@michael.financier',
      posts_per_day: 1,
    })
    accounts.push(await adapter.updateCampaignAccount(account.id, { status: 'ready' }))
  }

  // A video finished and waiting to go out.
  const video = await adapter.createVideo({
    campaign_id: campaign.id,
    setup: 'face',
    angle_id: null,
    script: null,
    blocked_reason: null,
    owed_for_date: null,
    rate_snapshot_cents: null,
    posted_at: null,
  })
  await adapter.advanceVideoPhase(video.id, { session: 'film' })
  await adapter.advanceVideoPhase(video.id, { session: 'edit' })

  return { campaign, accounts }
}

function renderScreen() {
  render(
    <DataContext.Provider value={adapter}>
      <MemoryRouter>
        <Posting />
      </MemoryRouter>
    </DataContext.Provider>,
  )
}

describe('the posting checklist', () => {
  it('lists one checkbox per ready account, with the handle to post from', async () => {
    await setUp()
    renderScreen()

    expect(await screen.findByRole('button', { name: /TikTok/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Instagram/ })).toBeInTheDocument()
    expect(screen.getAllByText('@michael.financier')).toHaveLength(2)
  })

  it('only marks the video posted once the last account is ticked', async () => {
    const user = userEvent.setup()
    const { campaign } = await setUp()
    renderScreen()

    await user.click(await screen.findByRole('button', { name: /TikTok/ }))

    // One of two done. Not posted, and nothing earned yet.
    await waitFor(async () => {
      const [video] = await adapter.listVideos({ campaignId: campaign.id })
      expect(video.phase).toBe('edited')
    })

    await user.click(screen.getByRole('button', { name: /Instagram/ }))

    await waitFor(async () => {
      const [video] = await adapter.listVideos({ campaignId: campaign.id })
      expect(video.phase).toBe('posted')
      // The rate is snapshotted on posting: this is the moment it is earned.
      expect(video.rate_snapshot_cents).toBe(3500)
    })
  })

  it('records which account each post went out from', async () => {
    const user = userEvent.setup()
    const { campaign, accounts } = await setUp()
    renderScreen()

    await user.click(await screen.findByRole('button', { name: /TikTok/ }))

    await waitFor(async () => {
      const [video] = await adapter.listVideos({ campaignId: campaign.id })
      const posts = await adapter.listVideoPosts(video.id)
      expect(posts).toHaveLength(1)
      expect(posts[0].account_id).toBe(accounts.find((a) => a.platform === 'TikTok')!.id)
      expect(posts[0].platform).toBe('TikTok')
    })
  })

  it('unticks, and takes the video back out of posted', async () => {
    const user = userEvent.setup()
    const { campaign } = await setUp()
    renderScreen()

    await user.click(await screen.findByRole('button', { name: /TikTok/ }))
    await user.click(screen.getByRole('button', { name: /Instagram/ }))
    await waitFor(async () => {
      const [video] = await adapter.listVideos({ campaignId: campaign.id })
      expect(video.phase).toBe('posted')
    })

    // He mis-tapped. It is no longer everywhere it needs to be.
    await user.click(screen.getByRole('button', { name: /Instagram/ }))

    await waitFor(async () => {
      const [video] = await adapter.listVideos({ campaignId: campaign.id })
      expect(video.phase).not.toBe('posted')
      // The rate comes off with it: it was not earned after all.
      expect(video.rate_snapshot_cents).toBeNull()
    })
  })

  it('never offers an account that is not ready to post from', async () => {
    const { accounts } = await setUp()
    await adapter.updateCampaignAccount(accounts[0].id, { status: 'warming' })
    renderScreen()

    await screen.findByRole('button', { name: /Instagram/ })
    // Posting brand content from an account still warming up is the thing
    // warm-up exists to prevent.
    expect(screen.queryByRole('button', { name: /TikTok/ })).toBeNull()
  })

  it('posts to every ready account in one tap, and marks the video posted', async () => {
    const user = userEvent.setup()
    const { campaign } = await setUp()
    renderScreen()

    await user.click(await screen.findByRole('button', { name: 'Posted everywhere' }))

    await waitFor(async () => {
      const [video] = await adapter.listVideos({ campaignId: campaign.id })
      expect(video.phase).toBe('posted')
      const posts = await adapter.listVideoPosts(video.id)
      expect(posts.map((p) => p.platform).sort()).toEqual(['Instagram', 'TikTok'])
    })
  })

  it('does not offer the bulk button when there is only one account to tick', async () => {
    const { accounts } = await setUp()
    // Down to one ready account - one tap and a bulk button would be the same
    // control twice.
    await adapter.updateCampaignAccount(accounts[0].id, { status: 'warming' })
    renderScreen()

    await screen.findByRole('button', { name: /Instagram/ })
    expect(screen.queryByRole('button', { name: 'Posted everywhere' })).toBeNull()
  })

  it('says how many are backed up, so a long list of identical cards is explained', async () => {
    await setUp()
    // A second video, also finished and waiting, so the campaign has a real
    // backlog rather than the one obligation for today.
    const [campaign] = await adapter.listCampaigns()
    const second = await adapter.createVideo({
      campaign_id: campaign.id,
      setup: 'face',
      angle_id: null,
      script: null,
      blocked_reason: null,
      owed_for_date: null,
      rate_snapshot_cents: null,
      posted_at: null,
    })
    await adapter.advanceVideoPhase(second.id, { session: 'film' })
    await adapter.advanceVideoPhase(second.id, { session: 'edit' })

    renderScreen()

    expect(await screen.findByText(/2 unposted/)).toBeInTheDocument()
  })
})
