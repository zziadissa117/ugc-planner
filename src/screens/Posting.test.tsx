// The posting checklist.
//
// A row is now an account, not a video: he asked for "very simply the
// campaigns platforms and check off if i posted in them for the day". The
// rule worth pinning underneath that is unchanged - a video is only posted,
// and the rate only snapshotted, once every ready account has a post against
// it, not on the first checkbox ticked.

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

async function setUp(postsPerDay = 1): Promise<{ campaign: Campaign; accounts: CampaignAccount[] }> {
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
      posts_per_day: postsPerDay,
    })
    accounts.push(await adapter.updateCampaignAccount(account.id, { status: 'ready' }))
  }

  return { campaign, accounts }
}

async function addEditedVideo(campaignId: string) {
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
  await adapter.advanceVideoPhase(video.id, { session: 'film' })
  await adapter.advanceVideoPhase(video.id, { session: 'edit' })
  return video
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
  it('lists one row per ready account, with the handle to post from', async () => {
    await setUp()
    await addEditedVideo((await adapter.listCampaigns())[0].id)
    renderScreen()

    expect(await screen.findByRole('button', { name: /TikTok/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Instagram/ })).toBeInTheDocument()
    expect(screen.getAllByText('@michael.financier')).toHaveLength(2)
  })

  it('checking a platform posts to it and, once every account is checked, marks the video posted', async () => {
    const user = userEvent.setup()
    const { campaign } = await setUp()
    await addEditedVideo(campaign.id)
    renderScreen()

    await user.click(await screen.findByRole('button', { name: /TikTok/ }))

    // One of two accounts done. Not posted, and nothing earned yet.
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

  it('unchecking takes the post back, and the video with it if it had gone out', async () => {
    const user = userEvent.setup()
    const { campaign } = await setUp()
    await addEditedVideo(campaign.id)
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
      expect(video.rate_snapshot_cents).toBeNull()
    })
  })

  it('never offers an account that is not ready to post from', async () => {
    const { campaign, accounts } = await setUp()
    await addEditedVideo(campaign.id)
    await adapter.updateCampaignAccount(accounts[0].id, { status: 'warming' })
    renderScreen()

    await screen.findByRole('button', { name: /Instagram/ })
    expect(screen.queryByRole('button', { name: /TikTok/ })).toBeNull()
  })

  it('says nothing is ready to post when there is no edited stock yet', async () => {
    await setUp()
    renderScreen()

    const row = await screen.findByRole('button', { name: /TikTok/ })
    expect(row).toBeDisabled()
    expect(row).toHaveTextContent(/nothing ready to post/i)
  })

  it('shows a counter, not a checkbox, for an account needing more than one a day', async () => {
    const user = userEvent.setup()
    const { campaign } = await setUp(2)
    await addEditedVideo(campaign.id)
    await addEditedVideo(campaign.id)
    renderScreen()

    expect(await screen.findAllByText('0 of 2 today')).toHaveLength(2)

    const plusButtons = screen.getAllByRole('button', { name: '+' })
    await user.click(plusButtons[0])

    await waitFor(() => {
      expect(screen.getAllByText('1 of 2 today')).toHaveLength(1)
    })
  })

  it('resets the next day, so a fresh checkbox draws from the remaining backlog', async () => {
    const { campaign, accounts } = await setUp()
    const video = await addEditedVideo(campaign.id)
    await addEditedVideo(campaign.id)

    // Posted yesterday, so the checkbox has something to disagree with today.
    await adapter.addVideoPost({
      video_id: video.id,
      account_id: accounts[0].id,
      platform: accounts[0].platform,
      url: null,
      view_count: null,
      view_count_entered_at: null,
      posted_at: '2020-01-01T00:00:00.000Z',
    })

    renderScreen()

    // Yesterday's post does not count today.
    const row = await screen.findByRole('button', { name: /TikTok/ })
    expect(row).toHaveAttribute('aria-pressed', 'false')
  })
})
