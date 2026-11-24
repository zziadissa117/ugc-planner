import 'fake-indexeddb/auto'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import type { CampaignAccount } from '../data'
import { DataContext } from '../data/context'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { LocalDatabase } from '../data/local/db'
import { Ideate } from './Ideate'

let owner = false
vi.mock('../sync/owner', () => ({ useIsOwner: () => owner }))

const fetchCutterViews = vi.fn()
const listCutterCampaigns = vi.fn()
vi.mock('../sync/cutterViews', () => ({
  fetchCutterViews: (...a: unknown[]) => fetchCutterViews(...a),
  listCutterCampaigns: () => listCutterCampaigns(),
}))

const USER = '11111111-1111-4111-8111-111111111111'
// Tuesday, November 24 2026, mid-afternoon. The week is Sunday the 22nd to
// Saturday the 28th; last week started on the 15th.
const NOW = new Date(2026, 10, 24, 15, 0)
const THIS_WEEK = '2026-11-22'
const LAST_WEEK = '2026-11-15'

let adapter: LocalAdapter
let campaignId: string
let tiktok: CampaignAccount
let instagram: CampaignAccount
let facebook: CampaignAccount

const at = (day: number, hour = 12) => new Date(2026, 10, day, hour).toISOString()

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  owner = false
  fetchCutterViews.mockReset()
  listCutterCampaigns.mockReset()

  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`ideate-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()

  const campaign = await adapter.createCampaign({
    name: 'Login', company: null, default_setup: 'face', approval_mode: 'none',
    daily_post_quota: 1, posts_per_week: 7, pay_per_video_cents: 2000, cycle_size: null, min_views: 1000,
  })
  campaignId = campaign.id
  tiktok = await adapter.addCampaignAccount({ campaign_id: campaignId, platform: 'TikTok', handle: '@login.tt', status: 'ready' })
  instagram = await adapter.addCampaignAccount({ campaign_id: campaignId, platform: 'Instagram', handle: 'login.ig', status: 'ready' })
  facebook = await adapter.addCampaignAccount({
    campaign_id: campaignId, platform: 'Facebook', handle: 'login.fb', status: 'ready', bonus_only: true,
  })

  const video = (script: string | null = null) =>
    adapter.createVideo({
      campaign_id: campaignId, setup: null, angle_id: null, script, blocked_reason: null,
      owed_for_date: null, rate_snapshot_cents: null, posted_at: null,
    })
  const post = (videoId: string, account: CampaignAccount, postedAt: string) =>
    adapter.addVideoPost({
      video_id: videoId, account_id: account.id, platform: account.platform, posted_at: postedAt,
      url: null, view_count: null, view_count_entered_at: null,
    })

  // Last Thursday: one video, TikTok only.
  const v0 = await video()
  await post(v0.id, tiktok, at(19))
  // Monday: one video to all three accounts - one deliverable, three ticks.
  const v1 = await video('Hook: you are logging in wrong')
  await post(v1.id, tiktok, at(23, 10))
  await post(v1.id, instagram, at(23, 11))
  await post(v1.id, facebook, at(23, 12))
  // Today: a second video, TikTok only.
  const v2 = await video()
  await post(v2.id, tiktok, at(24, 9))

  // Two ideate hours: Tuesday and Thursday at 10 am (stored Monday = 0).
  await adapter.replacePlanBlocks([
    { kind: 'record', weekday: 0, start_minute: 18 * 60, duration_minutes: 120 },
    { kind: 'ideate', weekday: 1, start_minute: 600, duration_minutes: 60 },
    { kind: 'ideate', weekday: 3, start_minute: 600, duration_minutes: 60 },
  ])
})

afterEach(() => {
  vi.useRealTimers()
})

function renderScreen() {
  return render(
    <DataContext.Provider value={adapter}>
      <MemoryRouter>
        <Ideate />
      </MemoryRouter>
    </DataContext.Provider>,
  )
}

const account = (name: string) => screen.findByRole('region', { name })
const queuedNotes = async () => (await adapter.listPendingWrites()).filter((w) => w.table_name === 'ideate_notes')

describe('IDEATE', () => {
  it('shows his ideate time from the saved week, against the recommendation', async () => {
    renderScreen()
    expect(
      await screen.findByText('Your ideate time this week: Tue 10 am, Thu 10 am · 2h of 2–4h recommended'),
    ).toBeInTheDocument()
  })

  it("counts each account's posts in the week, one per tick, with what each earned", async () => {
    renderScreen()
    const tt = await account('TikTok @login.tt')
    expect(within(tt).getByLabelText('Posts')).toHaveTextContent('2')
    // $20 a video shared by the two paid platforms: $10 a tick.
    expect(within(tt).getByLabelText('Made')).toHaveTextContent('$20.00')
    expect(within(tt).getByRole('button', { name: /Mon, Nov 23 · Video 1 · TikTok/ })).toBeInTheDocument()
    expect(within(tt).getByRole('button', { name: /Tue, Nov 24 · Video 2 · TikTok/ })).toBeInTheDocument()
    // Last Thursday's post belongs to last week.
    expect(within(tt).queryByText(/Nov 19/)).toBeNull()

    const ig = screen.getByRole('region', { name: 'Instagram @login.ig' })
    expect(within(ig).getByLabelText('Posts')).toHaveTextContent('1')
    expect(within(ig).getByLabelText('Made')).toHaveTextContent('$10.00')
    expect(within(ig).getByRole('button', { name: /Mon, Nov 23 · Video 1 · Instagram/ })).toBeInTheDocument()

    const card = screen.getByRole('region', { name: 'Login' })
    // Two videos went out, however many platforms they went to.
    expect(within(card).getAllByLabelText('Videos')[0]).toHaveTextContent('2 of 7')
    expect(within(card).getAllByLabelText('Made')[0]).toHaveTextContent('$30.00')
    expect(within(card).getByLabelText('Min views')).toHaveTextContent('1,000')
  })

  it('says a bonus-only account is not paid per post, and puts no money on it', async () => {
    renderScreen()
    const fb = await account('Facebook @login.fb')
    expect(within(fb).getByText('Bonus only - not paid per post')).toBeInTheDocument()
    expect(within(fb).getByLabelText('Posts')).toHaveTextContent('1')
    expect(within(fb).getByLabelText('Made')).toHaveTextContent('Bonus only')
    expect(within(await account('TikTok @login.tt')).getByText(/^Paid per post/)).toBeInTheDocument()
  })

  it('goes back a week and forward again, and never past this week', async () => {
    const user = userEvent.setup()
    renderScreen()
    await account('TikTok @login.tt')
    expect(screen.getByText('This week')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Previous week' }))
    expect(await screen.findByText('Last week')).toBeInTheDocument()
    const tt = await account('TikTok @login.tt')
    expect(within(tt).getByLabelText('Posts')).toHaveTextContent('1')
    expect(within(tt).getByRole('button', { name: /Thu, Nov 19 · Video 1 · TikTok/ })).toBeInTheDocument()
    const ig = screen.getByRole('region', { name: 'Instagram @login.ig' })
    expect(within(ig).getByLabelText('Posts')).toHaveTextContent('0')
    expect(within(ig).getByText('Nothing posted on this account that week.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next week' }))
    expect(await screen.findByText('This week')).toBeInTheDocument()
    expect(within(await account('TikTok @login.tt')).getByLabelText('Posts')).toHaveTextContent('2')
  })

  it("saves an account's note on this device and queues it, then edits and deletes it", async () => {
    const user = userEvent.setup()
    renderScreen()
    const tt = await account('TikTok @login.tt')
    const box = within(tt).getByLabelText('Notes for the next recording')

    await user.type(box, 'Hook too slow - cut the first two seconds')
    await user.click(within(tt).getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect(await adapter.listIdeateNotes()).toHaveLength(1))
    const [saved] = await adapter.listIdeateNotes()
    expect(saved).toMatchObject({
      campaign_id: campaignId,
      account_id: tiktok.id,
      week_start: THIS_WEEK,
      body: 'Hook too slow - cut the first two seconds',
    })
    expect(await within(tt).findByText('Saved')).toBeInTheDocument()
    // Once, even though leaving the box and tapping Save both save.
    expect((await queuedNotes()).map((w) => [w.op, w.row_id])).toEqual([['insert', saved.id]])

    await user.clear(box)
    await user.type(box, 'Open on the result instead')
    await user.click(within(tt).getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect((await adapter.listIdeateNotes())[0]?.body).toBe('Open on the result instead'))
    expect(await adapter.listIdeateNotes()).toHaveLength(1)
    expect((await queuedNotes()).map((w) => [w.op, w.row_id])).toEqual([
      ['insert', saved.id],
      ['update', saved.id],
    ])

    await user.click(within(tt).getByRole('button', { name: 'Delete' }))
    await user.click(within(tt).getByRole('button', { name: 'Tap again to delete' }))
    await waitFor(async () => expect(await adapter.listIdeateNotes()).toHaveLength(0))
    expect((await queuedNotes()).at(-1)).toMatchObject({ op: 'delete', row_id: saved.id })
    expect(box).toHaveValue('')
  })

  it('saves the whole-campaign note when he leaves the box', async () => {
    const user = userEvent.setup()
    renderScreen()
    const card = await screen.findByRole('region', { name: 'Login' })
    await user.type(within(card).getByLabelText('Notes for the whole campaign'), 'Film all three in one take')
    await user.tab()
    await waitFor(async () => expect(await adapter.listIdeateNotes()).toHaveLength(1))
    expect((await adapter.listIdeateNotes())[0]).toMatchObject({ account_id: null, week_start: THIS_WEEK, body: 'Film all three in one take' })
  })

  it("shows earlier weeks' notes for reference, and opens the week they were written in", async () => {
    await adapter.saveIdeateNote({
      campaign_id: campaignId, account_id: tiktok.id, week_start: LAST_WEEK, body: 'Try a question as the hook',
    })
    const user = userEvent.setup()
    renderScreen()
    const tt = await account('TikTok @login.tt')
    expect(within(tt).getByText('Earlier notes (1 week)')).toBeInTheDocument()
    expect(within(tt).getByText('Try a question as the hook')).toBeInTheDocument()
    expect(within(tt).getByLabelText('Notes for the next recording')).toHaveValue('')

    await user.click(within(tt).getByRole('button', { name: /Last week · Nov 15 – 21/ }))
    expect(await screen.findByText('Last week')).toBeInTheDocument()
    await waitFor(async () =>
      expect(within(await account('TikTok @login.tt')).getByLabelText('Notes for the next recording')).toHaveValue(
        'Try a question as the hook',
      ),
    )
  })

  it('opens a post and starts a line about it in the account note', async () => {
    const user = userEvent.setup()
    renderScreen()
    const tt = await account('TikTok @login.tt')
    await user.click(within(tt).getByRole('button', { name: /Mon, Nov 23 · Video 1 · TikTok/ }))
    expect(within(tt).getByText('Hook: you are logging in wrong')).toBeInTheDocument()
    expect(within(tt).getByText(/also on Instagram, Facebook/)).toBeInTheDocument()

    await user.click(within(tt).getByRole('button', { name: 'Write a note about it' }))
    await waitFor(() => expect(within(tt).getByLabelText('Notes for the next recording')).toHaveValue('Video 1 (Mon, Nov 23): '))
  })

  it('says "No views yet" when there are no views to read, and asks nothing of the cutter', async () => {
    renderScreen()
    for (const name of ['TikTok @login.tt', 'Instagram @login.ig', 'Facebook @login.fb']) {
      expect(within(await account(name)).getByLabelText('Views')).toHaveTextContent('No views yet')
    }
    expect(listCutterCampaigns).not.toHaveBeenCalled()
    expect(fetchCutterViews).not.toHaveBeenCalled()
  })

  it('says "No views yet" for the owner when no cutter campaign matches', async () => {
    owner = true
    listCutterCampaigns.mockResolvedValue([{ id: 'x', name: 'Something else' }])
    renderScreen()
    expect(await screen.findByText(/No cutter campaign called Login/)).toBeInTheDocument()
    expect(within(await account('TikTok @login.tt')).getByLabelText('Views')).toHaveTextContent('No views yet')
    expect(fetchCutterViews).not.toHaveBeenCalled()
  })

  it("shows the owner his accounts' views from the cutter, only his, flagged under the line", async () => {
    owner = true
    listCutterCampaigns.mockResolvedValue([{ id: 'cut-login', name: 'Login' }])
    // Went out 30 hours ago: inside this week, and its first day has been read.
    const yesterday = new Date(NOW.getTime() - 30 * 3_600_000).toISOString()
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
        // Jake's post on the same cutter campaign: none of his numbers.
        id: 'jake',
        postedAt: yesterday,
        accounts: [{ name: 'Jake TT', platform: 'TikTok', profile: 'hooksandmike' }],
        views: { 'Jake TT': 90000 },
      },
    ])
    renderScreen()

    const tt = await account('TikTok @login.tt')
    await waitFor(() => expect(within(tt).getByLabelText('Views')).toHaveTextContent('150'))
    expect(within(tt).getByText('In the past 24 hours, we had less than 200 views for this account.')).toBeInTheDocument()
    expect(within(tt).getByText(/0 of 1 reached 1,000/)).toBeInTheDocument()

    const ig = screen.getByRole('region', { name: 'Instagram @login.ig' })
    expect(within(ig).getByLabelText('Views')).toHaveTextContent('2,400')
    expect(within(ig).queryByText(/In the past 24 hours/)).toBeNull()
    // The bonus-only account had no cutter post: nothing made up for it.
    expect(within(screen.getByRole('region', { name: 'Facebook @login.fb' })).getByLabelText('Views')).toHaveTextContent('No views yet')
    expect(screen.queryByText(/90,000/)).toBeNull()
    expect(fetchCutterViews).toHaveBeenCalledWith('cut-login', expect.any(String))
  })
})
