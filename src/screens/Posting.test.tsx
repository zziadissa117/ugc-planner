// The posting grid.
//
// The three bugs this replaces, all from real use:
//
//   - "Inflow" appearing three times, one card per unposted video, and cards
//     vanishing as they were ticked.
//   - "Nothing ready to post", because he had not pressed FILMED IT inside
//     the app for work he had already filmed, edited and posted elsewhere.
//   - Being held at "1 of 4" because only one video existed in the app.
//
// So: one campaign, one row per platform, one box per deliverable owed today,
// and never a refusal.

import 'fake-indexeddb/auto'
import { render, screen, waitFor, within } from '@testing-library/react'
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

/** Inflow as it really is: $35 a post, one post a day, three platforms. */
async function setUp(
  quota = 1,
  platforms = ['TikTok', 'Instagram', 'YouTube'],
): Promise<{ campaign: Campaign; accounts: CampaignAccount[] }> {
  const campaign = await adapter.createCampaign({
    name: 'Inflow',
    company: 'Inflowpay',
    default_setup: 'face',
    approval_mode: 'none',
    daily_post_quota: quota,
    pay_per_video_cents: 3500,
    cycle_size: null,
  })

  const accounts: CampaignAccount[] = []
  for (const platform of platforms) {
    const account = await adapter.addCampaignAccount({
      campaign_id: campaign.id,
      platform,
      handle: '@michael.financier',
    })
    accounts.push(await adapter.updateCampaignAccount(account.id, { status: 'ready' }))
  }

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

async function boxes(platform: string) {
  const row = (await screen.findByText(platform)).closest('li')!
  return within(row)
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-label')?.includes('post '))
}

describe('the posting grid', () => {
  it('shows one campaign and one row per platform, never one per video', async () => {
    const { campaign } = await setUp()
    // Two videos already finished. The old screen drew a card each and the
    // campaign name three times over.
    for (let i = 0; i < 2; i++) {
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
    }

    renderScreen()

    expect(await screen.findAllByRole('heading', { name: 'Inflow' })).toHaveLength(1)
    for (const platform of ['TikTok', 'Instagram', 'YouTube']) {
      expect(screen.getByText(platform)).toBeInTheDocument()
    }
    // One box per platform, because one post a day is owed.
    expect(await boxes('TikTok')).toHaveLength(1)
  })

  it('ticks each platform independently, and none of them disappear', async () => {
    const user = userEvent.setup()
    const { campaign } = await setUp()
    renderScreen()

    const [tiktok] = await boxes('TikTok')
    await user.click(tiktok)

    await waitFor(async () => {
      const videos = await adapter.listVideos({ campaignId: campaign.id })
      const posts = (await Promise.all(videos.map((v) => adapter.listVideoPosts(v.id)))).flat()
      expect(posts.map((p) => p.platform)).toEqual(['TikTok'])
    })

    // The other two are still there, still unticked.
    await waitFor(async () => {
      expect((await boxes('TikTok'))[0]).toHaveAttribute('aria-pressed', 'true')
    })
    expect((await boxes('Instagram'))[0]).toHaveAttribute('aria-pressed', 'false')
    expect((await boxes('YouTube'))[0]).toHaveAttribute('aria-pressed', 'false')
  })

  it('counts one deliverable however many platforms it went to', async () => {
    const user = userEvent.setup()
    const { campaign } = await setUp()
    renderScreen()

    for (const platform of ['TikTok', 'Instagram', 'YouTube']) {
      await user.click((await boxes(platform))[0])
      await waitFor(async () => {
        expect((await boxes(platform))[0]).toHaveAttribute('aria-pressed', 'true')
      })
    }

    // One video, posted three times. Not three videos, and not three payments.
    const posted = (await adapter.listVideos({ campaignId: campaign.id })).filter(
      (v) => v.phase === 'posted',
    )
    expect(posted).toHaveLength(1)
    expect(posted[0].rate_snapshot_cents).toBe(3500)
    expect(await adapter.listVideoPosts(posted[0].id)).toHaveLength(3)
    expect(screen.getByText('1 of 1 today')).toBeInTheDocument()
  })

  it('marks a post without anything having been filmed in the app', async () => {
    // He filmed it on his phone, edited it elsewhere and posted it. The app
    // was never told, and has no business refusing to record it.
    const user = userEvent.setup()
    const { campaign } = await setUp()
    expect(await adapter.listVideos({ campaignId: campaign.id })).toHaveLength(0)

    renderScreen()
    await user.click((await boxes('Instagram'))[0])

    await waitFor(async () => {
      const posted = (await adapter.listVideos({ campaignId: campaign.id })).filter(
        (v) => v.phase === 'posted',
      )
      expect(posted).toHaveLength(1)
    })
    expect(screen.queryByText(/nothing ready to post/i)).toBeNull()
  })

  it('lets him mark all four when four are owed and one was filmed', async () => {
    const user = userEvent.setup()
    const { campaign } = await setUp(4, ['Instagram'])
    const filmed = await adapter.createVideo({
      campaign_id: campaign.id,
      setup: 'face',
      angle_id: null,
      script: null,
      blocked_reason: null,
      owed_for_date: null,
      rate_snapshot_cents: null,
      posted_at: null,
    })
    await adapter.advanceVideoPhase(filmed.id, { session: 'film' })

    renderScreen()
    expect(await boxes('Instagram')).toHaveLength(4)

    for (let i = 0; i < 4; i++) {
      const all = await boxes('Instagram')
      await user.click(all[i])
      await waitFor(async () => {
        expect((await boxes('Instagram'))[i]).toHaveAttribute('aria-pressed', 'true')
      })
    }

    await waitFor(() => {
      expect(screen.getByText('4 of 4 today')).toBeInTheDocument()
    })
    const posted = (await adapter.listVideos({ campaignId: campaign.id })).filter(
      (v) => v.phase === 'posted',
    )
    expect(posted).toHaveLength(4)
  })

  it('takes a post back, and the deliverable with it once nothing is left', async () => {
    const user = userEvent.setup()
    const { campaign } = await setUp(1, ['Instagram'])
    renderScreen()

    await user.click((await boxes('Instagram'))[0])
    await waitFor(async () => {
      const posted = (await adapter.listVideos({ campaignId: campaign.id })).filter(
        (v) => v.phase === 'posted',
      )
      expect(posted).toHaveLength(1)
    })

    await user.click((await boxes('Instagram'))[0])
    await waitFor(async () => {
      const posted = (await adapter.listVideos({ campaignId: campaign.id })).filter(
        (v) => v.phase === 'posted',
      )
      // Un-earned along with it: the rate goes when the last post does.
      expect(posted).toHaveLength(0)
    })
  })

  it('keeps a deliverable posted while it is still up somewhere else', async () => {
    const user = userEvent.setup()
    const { campaign } = await setUp(1, ['Instagram', 'TikTok'])
    renderScreen()

    await user.click((await boxes('Instagram'))[0])
    await waitFor(async () => {
      expect((await boxes('Instagram'))[0]).toHaveAttribute('aria-pressed', 'true')
    })
    await user.click((await boxes('TikTok'))[0])
    await waitFor(async () => {
      expect((await boxes('TikTok'))[0]).toHaveAttribute('aria-pressed', 'true')
    })

    await user.click((await boxes('TikTok'))[0])

    await waitFor(async () => {
      const posted = (await adapter.listVideos({ campaignId: campaign.id })).filter(
        (v) => v.phase === 'posted',
      )
      // Still out on Instagram, so still posted.
      expect(posted).toHaveLength(1)
    })
  })

  it('allows an extra post beyond what is owed', async () => {
    const user = userEvent.setup()
    await setUp(1, ['Instagram'])
    renderScreen()

    // The day's one post first, so the next tap really is an extra one.
    await user.click((await boxes('Instagram'))[0])
    await waitFor(async () => {
      expect((await boxes('Instagram'))[0]).toHaveAttribute('aria-pressed', 'true')
    })

    await user.click(screen.getByRole('button', { name: 'Instagram extra post' }))

    await waitFor(async () => {
      expect(await boxes('Instagram')).toHaveLength(2)
    })
    // Over-delivery reads as over-delivery, not as a broken denominator.
    expect(screen.getByText('2 of 1 today')).toBeInTheDocument()
  })

  it('shows an account that is still warming up rather than hiding the platform', async () => {
    const { accounts } = await setUp(1, ['Instagram', 'TikTok'])
    await adapter.updateCampaignAccount(accounts[0].id, { status: 'warming' })
    renderScreen()

    expect(await screen.findByText('Instagram')).toBeInTheDocument()
    expect(screen.getByText('TikTok')).toBeInTheDocument()
    expect(screen.getByText('warming')).toBeInTheDocument()
  })

  it('clears the next day, and yesterday does not fill today in', async () => {
    const { campaign, accounts } = await setUp(1, ['Instagram'])
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
    await adapter.addVideoPost({
      video_id: video.id,
      account_id: accounts[0].id,
      platform: 'Instagram',
      url: null,
      view_count: null,
      view_count_entered_at: null,
      posted_at: '2020-01-01T00:00:00.000Z',
    })

    renderScreen()

    expect((await boxes('Instagram'))[0]).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('0 of 1 today')).toBeInTheDocument()
  })
})
