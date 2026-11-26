import 'fake-indexeddb/auto'
import { act, render, screen, waitFor, within } from '@testing-library/react'
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
  campaign: null,
  ...extra,
})

const answer = (posts: PostizPostView[], extra: Partial<PostizPostsAnswer> = {}): PostizPostsAnswer => ({
  connected: true,
  posts,
  reading: 0,
  source: 'postiz',
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
  vi.unstubAllGlobals()
})

function campaign(name: string, minViews: number | null) {
  return adapter.createCampaign({
    name, company: null, default_setup: 'face', approval_mode: 'none',
    daily_post_quota: 1, posts_per_week: 7, pay_per_video_cents: 2000, cycle_size: null, min_views: minViews,
  })
}

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

const region = (name: string) => screen.getByRole('region', { name })
const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(`^${name}`) })
const figure = (scope: string, label: string) => within(screen.getByRole('group', { name: scope })).getByLabelText(label)

async function openCampaign(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('tab', { name: new RegExp(`^${name}`) }))
  await screen.findByRole('group', { name: `${name} figures` })
}

describe('All campaigns', () => {
  it('opens on everything, then every campaign in priority order, each with its count', async () => {
    renderScreen()
    await screen.findByRole('group', { name: 'Overview' })
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.getAttribute('aria-label'))).toEqual(['All campaigns, 5 videos', 'Login, 4 videos', 'Inflow, 1 video'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('shows the overall figures from read views only, never counting an unread video as zero', async () => {
    renderScreen()
    await screen.findByRole('group', { name: 'Overview' })
    // Five out; four read: 4,500 + 1,200 + 300 + 99,999.
    expect(figure('Overview', 'Videos out')).toHaveTextContent('5')
    expect(figure('Overview', 'Total views')).toHaveTextContent('106K')
    expect(figure('Overview', 'Total views')).toHaveAttribute('title', '105,999')
    expect(figure('Overview', 'Average views')).toHaveTextContent('26.5K')
    // 300, 1,200, 4,500, 99,999: between the middle two.
    expect(figure('Overview', 'Median views')).toHaveTextContent('2,850')
    expect(figure('Overview', '1K+ views')).toHaveTextContent('75%3 of 4')
    expect(figure('Overview', '10K+ views')).toHaveTextContent('25%1 of 4')
    expect(screen.getByText("4 of 5 videos have views in. The rest aren't counted yet.")).toBeInTheDocument()
  })

  it('ranks the best videos across every campaign, with the campaign under each', async () => {
    renderScreen()
    const best = await screen.findByRole('region', { name: 'Best videos' })
    const tiles = within(best).getAllByRole('listitem')
    expect(tiles.map((t) => within(t).getByRole('link', { name: /opens on/ }).getAttribute('aria-label'))).toEqual([
      'TikTok, Mon, Nov 23, 99,999 views, opens on TikTok',
      'TikTok, Tue, Nov 24, 4,500 views, opens on TikTok',
      'Instagram, Mon, Nov 23, 1,200 views, opens on Instagram',
      'TikTok, Sun, Nov 22, 300 views, opens on TikTok',
    ])
    expect(tiles[0]).toHaveTextContent('Inflow')
    expect(tiles[1]).toHaveTextContent('Login')
  })

  it('ranks campaigns by views, and a tap on one opens it', async () => {
    const user = userEvent.setup()
    renderScreen()
    const table = await screen.findByRole('region', { name: 'By campaign' })
    const rows = within(table).getAllByRole('button')
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Inflow, 1 video, 99,999 views, average 99,999, best 99,999',
      'Login, 4 videos, 6,000 views, average 2,000, best 4,500',
    ])
    await user.click(rows[1])
    expect(tab('Login')).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('group', { name: 'Login figures' })).toBeInTheDocument()
  })

  it('breaks views down by platform, per post', async () => {
    renderScreen()
    const table = await screen.findByRole('region', { name: 'By platform' })
    const [tiktok, instagram] = within(table).getAllByRole('listitem')
    // Four TikTok posts, three read: 104,799 in all.
    expect(tiktok).toHaveTextContent('TikTokPosts: 4Views: 105KAvg: 34.9K')
    expect(instagram).toHaveTextContent('InstagramPosts: 1Views: 1.2KAvg: 1.2K')
  })

  it('charts the week by day: videos out, and the average of the read ones', async () => {
    renderScreen()
    await screen.findByRole('region', { name: 'By day' })
    const table = screen.getByRole('table', { name: 'Videos and average views by day' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(7)
    expect(rows.map((r) => r.textContent)).toEqual([
      'Sun, Nov 22' + '1' + '300',
      // Three out, two read: (1,200 + 99,999) / 2.
      'Mon, Nov 23' + '3' + '50,600',
      'Tue, Nov 24' + '1' + '4,500',
      'Wed, Nov 25' + '0' + '—',
      'Thu, Nov 26' + '0' + '—',
      'Fri, Nov 27' + '0' + '—',
      'Sat, Nov 28' + '0' + '—',
    ])
  })

  it('leaves his personal brand out of every overall figure, says so, and still shows it on its own', async () => {
    const user = userEvent.setup()
    loadPostizPosts.mockResolvedValue(
      answer([
        ...POSTS,
        post('tps', { platform: 'Instagram', handle: 'ziadtps', views: 500_000, publishedAt: at(24, 8) }),
      ]),
    )
    renderScreen()
    await screen.findByRole('group', { name: 'Overview' })
    expect(tab('All campaigns')).toHaveAttribute('aria-label', 'All campaigns, 5 videos')
    expect(figure('Overview', 'Videos out')).toHaveTextContent('5')
    expect(figure('Overview', 'Total views')).toHaveAttribute('title', '105,999')
    expect(screen.getByText('Leaves out @ziadtps, your personal brand.')).toBeInTheDocument()
    expect(within(region('Best videos')).queryByText('Other accounts')).not.toBeInTheDocument()

    await openCampaign(user, 'Other accounts')
    expect(figure('Other accounts figures', 'Total views')).toHaveAttribute('title', '500,000')
    expect(screen.queryByText('Leaves out @ziadtps, your personal brand.')).not.toBeInTheDocument()
  })

  it('says plainly when nothing went out in the period', async () => {
    loadPostizPosts.mockResolvedValue(answer([]))
    renderScreen()
    expect(await screen.findByText('Nothing posted this week.')).toBeInTheDocument()
    expect(figure('Overview', 'Average views')).toHaveTextContent('—')
    expect(screen.queryByRole('region', { name: 'By campaign' })).toBeNull()
  })
})

describe('one campaign', () => {
  it("scopes the figures and What's working to the campaign chosen", async () => {
    const user = userEvent.setup()
    renderScreen()
    await openCampaign(user, 'Login')

    expect(figure('Login figures', 'Videos out')).toHaveTextContent('4')
    expect(figure('Login figures', 'Total views')).toHaveTextContent('6,000')
    expect(figure('Login figures', 'Average views')).toHaveTextContent('2,000')
    expect(figure('Login figures', 'Median views')).toHaveTextContent('1,200')
    expect(figure('Login figures', 'Best')).toHaveTextContent('4.5K')
    expect(figure('Login figures', 'Worst')).toHaveTextContent('300')

    const working = region("What's working")
    const best = within(working).getByRole('list', { name: 'Best' })
    const weakest = within(working).getByRole('list', { name: 'Weakest' })
    expect(within(best).getAllByRole('link', { name: /opens on/ }).map((a) => a.getAttribute('href'))).toEqual([
      'https://www.tiktok.com/@login.tt/video/best',
      'https://www.tiktok.com/@login.tt/video/ig',
    ])
    expect(within(weakest).getByRole('link', { name: /opens on/ })).toHaveAttribute('href', 'https://www.tiktok.com/@login.tt/video/worst')
    // Inflow's 99,999 is nowhere in Login's.
    expect(within(working).queryByText('100K')).toBeNull()

    await openCampaign(user, 'Inflow')
    const inflowWorking = region("What's working")
    expect(within(inflowWorking).getAllByRole('link', { name: /opens on/ }).map((a) => a.getAttribute('href'))).toEqual([
      'https://www.tiktok.com/@login.tt/video/inflow',
    ])
    expect(within(inflowWorking).queryByRole('list', { name: 'Weakest' })).toBeNull()
    expect(figure('Inflow figures', 'Worst')).toHaveTextContent('—')
    // The posts are read once for the period, not again per campaign.
    expect(loadPostizPosts).toHaveBeenCalledTimes(1)
  })

  it('lists each account, best average first', async () => {
    const user = userEvent.setup()
    renderScreen()
    await openCampaign(user, 'Login')
    const rows = within(region('By account')).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([
      // Three posts, two read: (4,500 + 300) / 2.
      'TikTok @login.ttPosts: 3Avg: 2.4KBest: 4.5K',
      'Instagram @login.igPosts: 1Avg: 1.2KBest: 1.2K',
    ])
  })

  it('shows every video newest first, an unread one saying so - never 0 - and not tappable without a link', async () => {
    const user = userEvent.setup()
    renderScreen()
    await openCampaign(user, 'Login')
    const tiles = within(region('Videos')).getAllByRole('listitem')
    expect(tiles.map((t) => t.querySelector('[aria-label]')?.getAttribute('aria-label'))).toEqual([
      'TikTok, Tue, Nov 24, 4,500 views, opens on TikTok',
      'TikTok, Mon, Nov 23, views not in yet',
      'Instagram, Mon, Nov 23, 1,200 views, opens on Instagram',
      'TikTok, Sun, Nov 22, 300 views, opens on TikTok',
    ])
    const unread = tiles[1]
    expect(within(unread).getByText('Views not in yet')).toBeInTheDocument()
    expect(unread).not.toHaveTextContent(/(^|\D)0(\D|$)/)
    expect(within(unread).queryByRole('link')).toBeNull()

    const best = within(tiles[0]).getByRole('link', { name: /opens on TikTok/ })
    expect(best).toHaveAttribute('target', '_blank')
    expect(best).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
    expect(tiles[0].querySelector('img')).toHaveAttribute('src', 'https://cdn.example.com/best.jpg')
  })

  it('shows a video sent to several platforms once, opening on Instagram, with a mark for each platform', async () => {
    loadPostizPosts.mockResolvedValue(
      answer([
        post('tt', { group: 'g', views: 900, preview: 'https://cdn.example.com/tt.jpg', publishedAt: at(23, 10) }),
        post('ig', { group: 'g', platform: 'Instagram', handle: 'login.ig', views: 300, preview: null, previewKind: null, url: 'https://www.instagram.com/reel/ig', publishedAt: at(23, 10) }),
      ]),
    )
    const user = userEvent.setup()
    renderScreen()
    await openCampaign(user, 'Login')
    expect(figure('Login figures', 'Videos out')).toHaveTextContent('1')
    expect(figure('Login figures', 'Average views')).toHaveTextContent('1,200')

    const [tile] = within(region('Videos')).getAllByRole('listitem')
    const open = within(tile).getByRole('link', { name: 'Instagram + TikTok, Mon, Nov 23, 1,200 views, opens on Instagram' })
    expect(open).toHaveAttribute('href', 'https://www.instagram.com/reel/ig')
    expect(open).toHaveAttribute('target', '_blank')
    // Instagram has no preview from Postiz: TikTok's is shown.
    expect(tile.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.com/tt.jpg')
    expect(within(tile).getByRole('link', { name: 'TikTok post, 900 views' })).toHaveAttribute('href', 'https://www.tiktok.com/@login.tt/video/tt')
    expect(within(tile).getByRole('link', { name: 'Instagram post, 300 views' })).toHaveAttribute('target', '_blank')
  })

  it('gives a video with no preview at all a card of its own, not an empty box', async () => {
    loadPostizPosts.mockResolvedValue(
      answer([post('ig', { platform: 'Instagram', handle: 'login.ig', preview: null, previewKind: null, caption: 'POV: you finally fixed your login\nmore', views: 10 })]),
    )
    const user = userEvent.setup()
    renderScreen()
    await openCampaign(user, 'Login')
    const [tile] = within(region('Videos')).getAllByRole('listitem')
    expect(tile.querySelector('img, video')).toBeNull()
    expect(within(tile).getByText('POV: you finally fixed your login')).toBeInTheDocument()
  })

  it("shows the cutter's video file as its first frame, never playing", async () => {
    loadPostizPosts.mockResolvedValue(answer([post('v', { preview: 'https://cdn.example.com/v.mp4', previewKind: 'video', views: 10 })]))
    const user = userEvent.setup()
    renderScreen()
    await openCampaign(user, 'Login')
    const video = region('Videos').querySelector('video')!
    expect(video).toHaveAttribute('src', 'https://cdn.example.com/v.mp4#t=0.5')
    expect(video).toHaveAttribute('preload', 'metadata')
    expect(video.muted).toBe(true)
    expect(video).not.toHaveAttribute('autoplay')
  })

  it('loads a preview only once its tile comes near the screen', async () => {
    const watching: { callback: IntersectionObserverCallback; element: Element }[] = []
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        callback: IntersectionObserverCallback
        constructor(callback: IntersectionObserverCallback) {
          this.callback = callback
        }
        observe(element: Element) {
          watching.push({ callback: this.callback, element })
        }
        disconnect() {}
      },
    )
    loadPostizPosts.mockResolvedValue(answer([post('v', { preview: 'https://cdn.example.com/v.mp4', previewKind: 'video', views: 10 })]))
    const user = userEvent.setup()
    renderScreen()
    await openCampaign(user, 'Login')
    const grid = region('Videos')
    expect(grid.querySelector('video')).toBeNull()

    const tile = watching.find((w) => grid.contains(w.element))!
    act(() => tile.callback([{ isIntersecting: true, target: tile.element } as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(grid.querySelector('video')).toHaveAttribute('src', 'https://cdn.example.com/v.mp4#t=0.5')
  })

  it('pages a long month 24 videos at a time', async () => {
    loadPostizPosts.mockResolvedValue(answer(Array.from({ length: 30 }, (_, i) => post(`v${i}`, { views: i, publishedAt: at(23, 0) }))))
    const user = userEvent.setup()
    renderScreen()
    await openCampaign(user, 'Login')
    const grid = region('Videos')
    expect(within(grid).getAllByRole('listitem')).toHaveLength(24)
    expect(within(grid).getByText('24 of 30')).toBeInTheDocument()
    await user.click(within(grid).getByRole('button', { name: 'Show more' }))
    expect(within(grid).getAllByRole('listitem')).toHaveLength(30)
    expect(within(grid).queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it('offers an empty campaign dimmed, not hidden, and says where its handles go', async () => {
    const empty = await campaign('Quiet one', null)
    const user = userEvent.setup()
    renderScreen()
    const quiet = await screen.findByRole('tab', { name: 'Quiet one, 0 videos' })
    expect(quiet).toHaveClass('text-state-later/70')
    await openCampaign(user, 'Quiet one')
    expect(screen.getByText(/Nothing posted this week\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add them' })).toHaveAttribute('href', `/campaigns/${empty.id}`)
  })
})

describe('where the videos come from', () => {
  const cutterPosts = [
    post('gd-1', { handle: 'traderzi2', platform: 'Instagram', url: 'https://www.instagram.com/reel/gd1', preview: 'https://cdn.example.com/gd1.mp4', previewKind: 'video', views: 2400, publishedAt: at(24, 8), campaign: { id: 'cut-gd', name: 'GoDaddy traderzi2' } }),
    post('gd-2', { handle: 'traderzi2', platform: 'Instagram', url: 'https://www.instagram.com/reel/gd2', preview: 'https://cdn.example.com/gd2.mp4', previewKind: 'video', views: null, publishedAt: at(23, 8), campaign: { id: 'cut-gd', name: 'GoDaddy traderzi2' } }),
  ]

  it("keeps a cutter campaign the planner has no campaign for under its own name, and says nothing about limits", async () => {
    loadPostizPosts.mockResolvedValue(answer([...POSTS, ...cutterPosts], { source: 'cutter', reading: 0 }))
    const user = userEvent.setup()
    renderScreen()
    await screen.findByRole('group', { name: 'Overview' })
    expect(screen.getAllByRole('tab').map((t) => t.getAttribute('aria-label'))).toEqual([
      'All campaigns, 7 videos',
      'Login, 4 videos',
      'Inflow, 1 video',
      'GoDaddy traderzi2, 2 videos',
    ])
    expect(screen.queryByText(/requests|coming in|used up/i)).toBeNull()

    await openCampaign(user, 'GoDaddy traderzi2')
    expect(within(region('Videos')).getAllByRole('listitem')).toHaveLength(2)
    expect(within(region('Videos')).getByRole('link', { name: /2,400 views, opens on Instagram/ })).toHaveAttribute('href', 'https://www.instagram.com/reel/gd1')
    // Notes need a planner campaign: one quiet line says how to get one.
    expect(screen.getByRole('link', { name: 'Add GoDaddy traderzi2 as a campaign' })).toHaveAttribute('href', '/campaigns/new')
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('from Postiz, says in one quiet line that views are still coming in', async () => {
    loadPostizPosts.mockResolvedValue(answer(POSTS, { reading: 3, error: "This hour's Postiz requests for your key are used up, so the new post may be missing." }))
    renderScreen()
    const line = await screen.findByText('Views for 1 video is still coming in.')
    expect(line).toHaveClass('text-text-dim')
    expect(screen.queryByText(/used up/)).toBeNull()
  })

  it('from Postiz, with nothing still coming in, gives the reason in the same quiet line - never a red box', async () => {
    loadPostizPosts.mockResolvedValue(answer(POSTS, { reading: 0, error: "This hour's Postiz requests for your key are used up." }))
    renderScreen()
    const line = await screen.findByText("This hour's Postiz requests for your key are used up.")
    expect(line).toHaveClass('text-text-dim')
    expect(line).not.toHaveClass('text-state-blocked')
  })

  it('without a Postiz key, says where to add one - and the notes still work', async () => {
    loadPostizPosts.mockResolvedValue({ connected: false, posts: [], reading: 0 })
    const user = userEvent.setup()
    renderScreen()
    const link = await screen.findByRole('link', { name: 'Add your Postiz key' })
    expect(link).toHaveAttribute('href', '/settings#postiz')
    expect(screen.queryByRole('group', { name: 'Overview' })).toBeNull()

    await user.click(tab('Login'))
    expect(screen.getByRole('textbox', { name: 'Your notes' })).toBeInTheDocument()
  })

  it('reads the period asked for: last week runs Sunday to Sunday', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByRole('group', { name: 'Overview' })
    await user.click(screen.getByRole('button', { name: 'Last week' }))
    await waitFor(() => expect(loadPostizPosts).toHaveBeenCalledTimes(2))
    expect(loadPostizPosts).toHaveBeenLastCalledWith({ from: new Date(2026, 10, 15).toISOString(), to: new Date(2026, 10, 22).toISOString() })
    expect(screen.getByRole('button', { name: 'Last week' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('says quietly when the videos could not be read, and reads them again on request', async () => {
    loadPostizPosts.mockRejectedValueOnce(new Error('Network down'))
    const user = userEvent.setup()
    renderScreen()
    const line = await screen.findByText("Videos didn't load: Network down")
    expect(line).not.toHaveClass('text-state-blocked')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('group', { name: 'Overview' })).toBeInTheDocument()
    expect(loadPostizPosts).toHaveBeenCalledTimes(2)
  })
})

describe('notes', () => {
  it('offline, says the videos need a connection and still saves a note on the device', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const user = userEvent.setup()
    renderScreen()

    expect(await screen.findByText('Offline. Videos and views need a connection.')).toBeInTheDocument()
    expect(loadPostizPosts).not.toHaveBeenCalled()

    await user.click(tab('Login'))
    await user.type(screen.getByRole('textbox', { name: 'Your notes' }), 'Shorter hook')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Shorter hook')).toBeInTheDocument()
    const [saved] = await adapter.listIdeateNotes()
    expect(saved).toMatchObject({ campaign_id: login.id, week_start: '2026-11-22', body: 'Shorter hook', account_id: null })
    expect((await adapter.listPendingWrites()).some((w) => w.table_name === 'ideate_notes')).toBe(true)
  })

  it('keeps each campaign to its own notes', async () => {
    await adapter.saveIdeateNote({ campaign_id: login.id, account_id: null, week_start: '2026-11-22', body: 'Login note' })
    await adapter.saveIdeateNote({ campaign_id: inflow.id, account_id: null, week_start: '2026-11-22', body: 'Inflow note' })
    const user = userEvent.setup()
    renderScreen()

    await openCampaign(user, 'Login')
    expect(await screen.findByText('Login note')).toBeInTheDocument()
    expect(screen.queryByText('Inflow note')).toBeNull()

    await openCampaign(user, 'Inflow')
    expect(await screen.findByText('Inflow note')).toBeInTheDocument()
    expect(screen.queryByText('Login note')).toBeNull()
  })

  it("shows Ziad's notes to the student, read only", async () => {
    await adapter.applyRemoteRow('coach_notes', coachNote({ post_url: 'https://www.tiktok.com/@login.tt/video/best' }))
    const user = userEvent.setup()
    renderScreen()
    await openCampaign(user, 'Login')

    const section = await screen.findByRole('region', { name: 'Notes from Ziad' })
    expect(within(section).getByText('Open on the product, not your face')).toBeInTheDocument()
    expect(within(section).getByRole('link', { name: 'The video ↗' })).toHaveAttribute('target', '_blank')
    expect(within(section).queryByRole('textbox')).toBeNull()
    expect(within(section).queryByRole('button', { name: /edit|delete|save/i })).toBeNull()
  })

  it('says when Ziad has written nothing yet', async () => {
    const user = userEvent.setup()
    renderScreen()
    await openCampaign(user, 'Login')
    const section = await screen.findByRole('region', { name: 'Notes from Ziad' })
    expect(within(section).getByText('Nothing from Ziad yet.')).toBeInTheDocument()
  })

  it('writes, edits and deletes their own notes', async () => {
    const user = userEvent.setup()
    renderScreen()
    await openCampaign(user, 'Login')
    const section = await screen.findByRole('region', { name: 'Your notes' })

    await user.type(within(section).getByRole('textbox', { name: 'Your notes' }), 'Film outside')
    await user.click(within(section).getByRole('button', { name: 'Save' }))
    expect(await within(section).findByText('Film outside')).toBeInTheDocument()
    // The box empties once the save has finished, which can be a tick after the note shows.
    await waitFor(() => expect(within(section).getByRole('textbox', { name: 'Your notes' })).toHaveValue(''))

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
    await openCampaign(user, 'Login')
    await user.click(within(region("What's working")).getByRole('button', { name: 'Note on this video: TikTok, Tue, Nov 24, 4,500 views' }))

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
    const user = userEvent.setup()
    renderScreen()
    expect(await screen.findByRole('link', { name: /Students/ })).toHaveAttribute('href', '/coach')
    await openCampaign(user, 'Login')
    await screen.findByRole('region', { name: 'Your notes' })
    expect(screen.queryByRole('region', { name: 'Notes from Ziad' })).toBeNull()
  })

  it('is not offered to a student', async () => {
    renderScreen()
    await screen.findByRole('group', { name: 'Overview' })
    expect(screen.queryByRole('link', { name: /Students/ })).toBeNull()
  })
})
