import 'fake-indexeddb/auto'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import type { Campaign, CoachNote } from '../data'
import { DataContext } from '../data/context'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { LocalDatabase } from '../data/local/db'
import type { PostizPostView, PostizPostsAnswer } from '../sync/postizPosts'
import { Ideate } from './Ideate'

let owner = false
vi.mock('../sync/owner', () => ({ useIsOwner: () => owner }))

const loadPostizPosts = vi.fn()
vi.mock('../sync/postizPosts', () => ({ loadPostizPosts: (...a: unknown[]) => loadPostizPosts(...a) }))

const USER = '11111111-1111-4111-8111-111111111111'
const COACH = '22222222-2222-4222-8222-222222222222'
// Tuesday, November 24 2026, mid-afternoon. The week is Sunday the 22nd to
// Saturday the 28th.
const NOW = new Date(2026, 10, 24, 15, 0)
const at = (day: number, hour = 12) => new Date(2026, 10, day, hour).toISOString()

let adapter: LocalAdapter
let login: Campaign
let inflow: Campaign

const post = (id: string, extra: Partial<PostizPostView> = {}): PostizPostView => ({
  id,
  group: null,
  platform: 'TikTok',
  handle: 'login.tt',
  url: `https://www.tiktok.com/@login.tt/video/${id}`,
  preview: `https://cdn.example.com/${id}.jpg`,
  previewKind: 'image',
  caption: `Caption ${id}`,
  status: 'posted',
  publishedAt: at(23),
  views: null,
  viewsAt: null,
  ...extra,
})

const answer = (posts: PostizPostView[], extra: Partial<PostizPostsAnswer> = {}): PostizPostsAnswer => ({
  connected: true,
  posts,
  reading: 0,
  ...extra,
})

const POSTS = [
  post('best', { views: 4500, publishedAt: at(24, 9) }),
  post('unread', { views: null, publishedAt: at(23, 20), url: null }),
  post('ig', { platform: 'Instagram', handle: 'login.ig', views: 1200, publishedAt: at(23, 11) }),
  post('worst', { views: 300, publishedAt: at(22, 10) }),
  // Another campaign's account.
  post('inflow', { handle: 'inflow.tt', views: 99999, publishedAt: at(23, 9) }),
  // Not out yet.
  post('scheduled', { status: 'scheduled', views: null, publishedAt: at(27) }),
]

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  owner = false
  loadPostizPosts.mockReset().mockResolvedValue(answer(POSTS))

  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`ideate-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()

  const campaign = (name: string, minViews: number | null) =>
    adapter.createCampaign({
      name, company: null, default_setup: 'face', approval_mode: 'none',
      daily_post_quota: 1, posts_per_week: 7, pay_per_video_cents: 2000, cycle_size: null, min_views: minViews,
    })
  // Inflow is created first, but Login needs a minimum views, so it comes first.
  inflow = await campaign('Inflow', null)
  login = await campaign('Login', 1000)
  await adapter.addCampaignAccount({ campaign_id: login.id, platform: 'TikTok', handle: '@login.tt', status: 'ready' })
  await adapter.addCampaignAccount({ campaign_id: login.id, platform: 'Instagram', handle: 'login.ig', status: 'ready' })
  await adapter.addCampaignAccount({ campaign_id: inflow.id, platform: 'TikTok', handle: 'inflow.tt', status: 'ready' })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
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

const coachNote = (overrides: Partial<CoachNote> = {}): CoachNote => ({
  id: crypto.randomUUID(),
  user_id: USER,
  author_id: COACH,
  campaign_id: login.id,
  post_id: null,
  post_url: null,
  week_start: '2026-11-22',
  body: 'Open on the product, not your face',
  created_at: '2026-11-24T19:00:00.000000+00:00',
  updated_at: '2026-11-24T19:00:00.000000+00:00',
  deleted_at: null,
  ...overrides,
})

const videos = () => screen.getByRole('region', { name: 'Videos' })

describe('IDEATE', () => {
  it('opens on the first campaign in priority order, and shows only its videos', async () => {
    renderScreen()
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Login', 'Inflow'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')

    await screen.findByLabelText('Posted')
    expect(screen.getByLabelText('Posted')).toHaveTextContent('4')
    const tiles = within(videos()).getAllByRole('listitem')
    // Newest first; the other campaign's and the scheduled one are not here.
    expect(tiles.map((li) => li.querySelector('[aria-label]')?.getAttribute('aria-label')?.split(',')[0])).toEqual([
      'TikTok',
      'TikTok',
      'Instagram',
      'TikTok',
    ])
    expect(screen.queryByText(/inflow\.tt/)).toBeNull()
  })

  it('switching campaign scopes the figures, the videos and the notes', async () => {
    await adapter.saveIdeateNote({ campaign_id: login.id, account_id: null, week_start: '2026-11-22', body: 'Login note' })
    await adapter.saveIdeateNote({ campaign_id: inflow.id, account_id: null, week_start: '2026-11-22', body: 'Inflow note' })
    const user = userEvent.setup()
    renderScreen()

    expect(await screen.findByText('Login note')).toBeInTheDocument()
    expect(screen.queryByText('Inflow note')).toBeNull()

    await user.click(screen.getByRole('tab', { name: 'Inflow' }))
    expect(await screen.findByText('Inflow note')).toBeInTheDocument()
    expect(screen.queryByText('Login note')).toBeNull()
    expect(screen.getByLabelText('Posted')).toHaveTextContent('1')
    expect(screen.getByLabelText('Average views')).toHaveTextContent('99,999')
    expect(within(videos()).getAllByRole('listitem')).toHaveLength(1)
    // The posts are read once for the period, not again per campaign.
    expect(loadPostizPosts).toHaveBeenCalledTimes(1)
  })

  it('averages, ranks best and worst from read views only, and shows an unread one as a dash', async () => {
    renderScreen()
    // (4500 + 1200 + 300) / 3 = 2000. The unread video is not a zero.
    expect(await screen.findByLabelText('Average views')).toHaveTextContent('2,000')
    expect(screen.getByRole('link', { name: /^Best, TikTok, Tue, Nov 24, 4,500 views/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^Worst, TikTok, Sun, Nov 22, 300 views/ })).toBeInTheDocument()

    const unread = within(videos()).getByRole('img', { name: /views not in yet/ })
    expect(unread.closest('li')).toHaveTextContent('—')
  })

  it('opens a video with a link in a new tab, and does not make one without a link tappable', async () => {
    renderScreen()
    await screen.findByLabelText('Posted')
    const best = within(videos()).getByRole('link', { name: /4,500 views, opens on TikTok/ })
    expect(best).toHaveAttribute('href', 'https://www.tiktok.com/@login.tt/video/best')
    expect(best).toHaveAttribute('target', '_blank')
    expect(best).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
    expect(best.parentElement?.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.com/best.jpg')

    const unread = within(videos()).getByRole('img', { name: /views not in yet/ })
    expect(unread.closest('a')).toBeNull()
    expect(unread).not.toHaveAccessibleName(/opens/)
  })

  it('shows a video sent to several platforms once, opening on Instagram, with a chip for each platform', async () => {
    loadPostizPosts.mockResolvedValue(
      answer([
        post('tt', { group: 'g', views: 900, preview: 'https://cdn.example.com/tt.jpg', publishedAt: at(23, 10) }),
        post('ig', { group: 'g', platform: 'Instagram', handle: 'login.ig', views: 300, preview: null, previewKind: null, url: 'https://www.instagram.com/reel/ig', publishedAt: at(23, 10) }),
      ]),
    )
    renderScreen()
    expect(await screen.findByLabelText('Posted')).toHaveTextContent('1')
    expect(screen.getByLabelText('Average views')).toHaveTextContent('1,200')

    const [tile] = within(videos()).getAllByRole('listitem')
    const open = within(tile).getByRole('link', { name: 'Instagram + TikTok, Mon, Nov 23, 1,200 views, opens on Instagram' })
    expect(open).toHaveAttribute('href', 'https://www.instagram.com/reel/ig')
    // Instagram has no preview from Postiz: TikTok's is shown.
    expect(tile.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.com/tt.jpg')
    expect(within(tile).getByRole('link', { name: 'TikTok post, 900 views' })).toHaveAttribute('href', 'https://www.tiktok.com/@login.tt/video/tt')
    expect(within(tile).getByRole('link', { name: 'Instagram post, 300 views' })).toHaveAttribute('target', '_blank')
  })

  it('gives a video with no preview at all a card of its own, not an empty box', async () => {
    loadPostizPosts.mockResolvedValue(
      answer([post('ig', { platform: 'Instagram', handle: 'login.ig', preview: null, previewKind: null, caption: 'POV: you finally fixed your login\nmore', views: 10 })]),
    )
    renderScreen()
    await screen.findByLabelText('Posted')
    const [tile] = within(videos()).getAllByRole('listitem')
    expect(tile.querySelector('img, video')).toBeNull()
    expect(within(tile).getByText('POV: you finally fixed your login')).toBeInTheDocument()
  })

  it('shows a video file as its first frame, never playing', async () => {
    loadPostizPosts.mockResolvedValue(answer([post('v', { preview: 'https://cdn.example.com/v.mp4', previewKind: 'video', views: 10 })]))
    const { container } = renderScreen()
    await screen.findByLabelText('Posted')
    const video = container.querySelector('video')!
    expect(video).toHaveAttribute('preload', 'metadata')
    expect(video.muted).toBe(true)
    expect(video).not.toHaveAttribute('autoplay')
  })

  it('says views are still coming in while Postiz is reading them', async () => {
    loadPostizPosts.mockResolvedValue(answer(POSTS, { reading: 3 }))
    renderScreen()
    expect(await screen.findByText('Views still coming in for 1 video')).toBeInTheDocument()
  })

  it('without a Postiz key, says where to add one - and the notes still work', async () => {
    loadPostizPosts.mockResolvedValue({ connected: false, posts: [], reading: 0 })
    renderScreen()
    const link = await screen.findByRole('link', { name: 'Add your Postiz key' })
    expect(link).toHaveAttribute('href', '/settings#postiz')
    expect(screen.queryByLabelText('Posted')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Your notes' })).toBeInTheDocument()
  })

  it('offline, says the videos need a connection and still saves a note on the device', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const user = userEvent.setup()
    renderScreen()

    expect(await screen.findByText('Offline. Videos and views need a connection.')).toBeInTheDocument()
    expect(loadPostizPosts).not.toHaveBeenCalled()

    await user.type(screen.getByRole('textbox', { name: 'Your notes' }), 'Shorter hook')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Shorter hook')).toBeInTheDocument()
    const [saved] = await adapter.listIdeateNotes()
    expect(saved).toMatchObject({ campaign_id: login.id, week_start: '2026-11-22', body: 'Shorter hook', account_id: null })
    expect((await adapter.listPendingWrites()).some((w) => w.table_name === 'ideate_notes')).toBe(true)
  })

  it('reads the period asked for: last week runs Sunday to Sunday', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByLabelText('Posted')
    await user.click(screen.getByRole('button', { name: 'Last week' }))
    await waitFor(() => expect(loadPostizPosts).toHaveBeenCalledTimes(2))
    expect(loadPostizPosts).toHaveBeenLastCalledWith({ from: new Date(2026, 10, 15).toISOString(), to: new Date(2026, 10, 22).toISOString() })
    expect(screen.getByRole('button', { name: 'Last week' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('says plainly when nothing went out in the period', async () => {
    loadPostizPosts.mockResolvedValue(answer([]))
    renderScreen()
    expect(await screen.findByText('Nothing posted this week.')).toBeInTheDocument()
    expect(screen.getByLabelText('Average views')).toHaveTextContent('—')
  })
})

describe('notes', () => {
  it("shows Ziad's notes to the student, read only", async () => {
    await adapter.applyRemoteRow('coach_notes', coachNote({ post_url: 'https://www.tiktok.com/@login.tt/video/best' }))
    renderScreen()

    const section = await screen.findByRole('region', { name: 'Notes from Ziad' })
    expect(within(section).getByText('Open on the product, not your face')).toBeInTheDocument()
    expect(within(section).getByRole('link', { name: 'The video ↗' })).toHaveAttribute('target', '_blank')
    expect(within(section).queryByRole('textbox')).toBeNull()
    expect(within(section).queryByRole('button', { name: /edit|delete|save/i })).toBeNull()
  })

  it('says when Ziad has written nothing yet', async () => {
    renderScreen()
    const section = await screen.findByRole('region', { name: 'Notes from Ziad' })
    expect(within(section).getByText('Nothing from Ziad yet.')).toBeInTheDocument()
  })

  it('writes, edits and deletes their own notes', async () => {
    const user = userEvent.setup()
    renderScreen()
    const section = await screen.findByRole('region', { name: 'Your notes' })

    await user.type(within(section).getByRole('textbox', { name: 'Your notes' }), 'Film outside')
    await user.click(within(section).getByRole('button', { name: 'Save' }))
    expect(await within(section).findByText('Film outside')).toBeInTheDocument()
    expect(within(section).getByRole('textbox', { name: 'Your notes' })).toHaveValue('')

    await user.click(within(section).getByRole('button', { name: 'Edit' }))
    const box = within(section).getByRole('textbox', { name: 'Your notes' })
    expect(box).toHaveValue('Film outside')
    await user.clear(box)
    await user.type(box, 'Film outside, at noon')
    await user.click(within(section).getByRole('button', { name: 'Save changes' }))
    expect(await within(section).findByText('Film outside, at noon')).toBeInTheDocument()
    expect(await adapter.listIdeateNotes()).toHaveLength(1)

    await user.click(within(section).getByRole('button', { name: 'Delete' }))
    await user.click(within(section).getByRole('button', { name: 'Tap again to delete' }))
    await waitFor(() => expect(within(section).queryByText('Film outside, at noon')).toBeNull())
    expect(await adapter.listIdeateNotes()).toEqual([])
  })

  it('starts a note about the best video, filed under its account and week', async () => {
    const user = userEvent.setup()
    renderScreen()
    await user.click(await screen.findByRole('button', { name: 'Note on the best video' }))

    const box = screen.getByRole('textbox', { name: 'Your notes' })
    await waitFor(() => expect(box).toHaveValue('TikTok, Tue, Nov 24: '))
    await user.type(box, 'the hook worked')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(async () => expect(await adapter.listIdeateNotes()).toHaveLength(1))
    const [saved] = await adapter.listIdeateNotes()
    const tiktok = (await adapter.listCampaignAccounts(login.id)).find((a) => a.platform === 'TikTok')
    expect(saved).toMatchObject({ body: 'TikTok, Tue, Nov 24: the hook worked', account_id: tiktok?.id, week_start: '2026-11-22' })
  })
})

describe('the owner', () => {
  it('gets a way to his students, and no empty notes-from-himself section', async () => {
    owner = true
    renderScreen()
    expect(await screen.findByRole('link', { name: /Students/ })).toHaveAttribute('href', '/coach')
    await screen.findByRole('region', { name: 'Your notes' })
    expect(screen.queryByRole('region', { name: 'Notes from Ziad' })).toBeNull()
  })

  it('is not offered to a student', async () => {
    renderScreen()
    await screen.findByRole('region', { name: 'Your notes' })
    expect(screen.queryByRole('link', { name: /Students/ })).toBeNull()
  })
})
