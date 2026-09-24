// The home screen: the day's count, one tap to mark something edited, and the
// way into filming. The planner, the session chooser, the window picker, the
// EDIT console and the POST session are all gone; what is tested here is what
// is left.

import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { DataContext } from '../data/context'
import type { DataAdapter } from '../data/DataAdapter'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { INFLOW_CAMPAIGN_ID, ensureSeeded } from '../data/seed'
import { WarmupTimersProvider } from '../warmupTimers'
import { Now } from './Now'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: DataAdapter
let database: LocalDatabase

beforeEach(async () => {
  localStorage.removeItem('ugc-planner.warmup_timers')
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`now-${crypto.randomUUID()}`)
  database = db
  adapter = new LocalAdapter(db, USER)
  await db.open()
  await ensureSeeded(adapter)
})

function renderScreen() {
  return render(
    <DataContext.Provider value={adapter}>
      <MemoryRouter>
        <WarmupTimersProvider>
          <Now />
        </WarmupTimersProvider>
      </MemoryRouter>
    </DataContext.Provider>,
  )
}

async function filmOne(campaignId = INFLOW_CAMPAIGN_ID) {
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
  return video
}

describe('the home screen', () => {
  it('shows the day against what is owed, not against what was filmed', async () => {
    renderScreen()
    // Inflow's seed owes one a day, and nothing has gone out.
    expect(await screen.findByText(/of 1/)).toBeInTheDocument()
    expect(screen.getByText(/posted today/)).toBeInTheDocument()
  })

  it('offers FILM and POST, and nothing that plans an evening', async () => {
    renderScreen()
    await screen.findByText(/of 1/)

    expect(screen.getByRole('button', { name: 'FILM' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'POST' })).toBeInTheDocument()
    for (const gone of ['EDIT', 'WARM-UP', 'Or plan it for me']) {
      expect(screen.queryByRole('button', { name: gone })).toBeNull()
    }
    expect(screen.queryByText(/how long tonight/i)).toBeNull()
    expect(screen.queryByRole('link', { name: /tick them off/i })).toBeNull()
  })

  it('counts a deliverable once however many platforms it went out on', async () => {
    // The bug this replaces: three platforms reading as three posts, and a
    // backlog of phase changes reading as a day's work.
    // The seed gives Inflow TikTok and Instagram; YouTube is the third.
    await adapter.addCampaignAccount({
      campaign_id: INFLOW_CAMPAIGN_ID,
      platform: 'YouTube',
      handle: '@michael.financier',
    })
    const accounts = await adapter.listCampaignAccounts(INFLOW_CAMPAIGN_ID)
    const video = await filmOne()
    for (const account of accounts) {
      await adapter.addVideoPost({
        video_id: video.id,
        account_id: account.id,
        platform: account.platform,
        url: null,
        view_count: null,
        view_count_entered_at: null,
      })
    }

    renderScreen()
    expect(await screen.findByText('1')).toBeInTheDocument()
    expect(screen.getByText(/of 1$/)).toBeInTheDocument()
  })
})

describe('the warm-up list, organised', () => {
  // "make the warmup section more organized". It was one card per account,
  // the campaign named after every handle, campaigns interleaved - so what
  // was left for one campaign meant reading every row.
  async function secondCampaign() {
    const campaign = await adapter.createCampaign({
      name: 'Vertus',
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      pay_per_video_cents: 4000,
      cycle_size: null,
    })
    for (const platform of ['X', 'TikTok', 'Instagram']) {
      await adapter.addCampaignAccount({
        campaign_id: campaign.id,
        platform,
        handle: `@vertus.${platform.toLowerCase()}`,
      })
    }
    return campaign
  }

  it('says which campaign each account belongs to, on the account itself', async () => {
    await secondCampaign()

    renderScreen()
    await screen.findByText(/Keep them warm/)

    // One row per account, each carrying its own campaign, rather than
    // campaigns being what the list is organised by.
    const rows = screen.getAllByRole('listitem')
    const vertusX = rows.find((row) => row.textContent?.includes('@vertus.x'))!
    const inflow = rows.find((row) => row.textContent?.includes('@michael.financier'))!
    expect(vertusX).toHaveTextContent('Vertus')
    expect(vertusX).not.toHaveTextContent('Inflow')
    expect(inflow).toHaveTextContent('Inflow')
  })

  it('breaks a tie by campaign, then by the platform picker, not the alphabet', async () => {
    await secondCampaign()

    renderScreen()
    await screen.findByText(/Keep them warm/)

    const platforms = screen
      .getAllByRole('listitem')
      .filter((row) => row.textContent?.includes('@vertus.'))
      .map((li) =>
        ['TikTok', 'Instagram', 'X'].find((p) => li.textContent?.includes(`@vertus.${p.toLowerCase()}`)),
      )
    // KNOWN_PLATFORMS order is Instagram, TikTok, YouTube, Facebook, X - and
    // they were added as X, TikTok, Instagram, so neither insertion order nor
    // the alphabet would produce this. All three are new, so nothing else
    // separates them.
    expect(platforms).toEqual(['Instagram', 'TikTok', 'X'])
  })
})

describe('the warm-up list, in order of priority', () => {
  /** A warm-up session that happened `daysAgo` days ago. The adapter stamps
   *  events with now, so the log is backdated directly. */
  async function warmedDaysAgo(accountId: string, daysAgo: number) {
    const event = await adapter.recordWarmupEvent(accountId, 5)
    const when = new Date(Date.now() - daysAgo * 86_400_000).toISOString()
    await database.warmup_events.update(event.id, { occurred_at: when })
  }

  async function account(platform: string, handle: string, status: 'new' | 'warming' | 'ready') {
    const created = await adapter.addCampaignAccount({
      campaign_id: INFLOW_CAMPAIGN_ID,
      platform,
      handle,
      status,
    })
    return created
  }

  /** The platform of each row, top to bottom - every account here is on its
   *  own platform, so that names the row. */
  async function order(): Promise<string[]> {
    await screen.findByText(/Keep them warm/)
    return screen
      .getAllByRole('listitem')
      .map((row) => {
        const text = (row.textContent ?? '').replace('✓', '')
        return ['Facebook', 'Instagram', 'TikTok', 'X'].find((p) => text.includes(p)) ?? '?'
      })
  }

  it('puts new and long-neglected accounts first, and ready fresh ones last', async () => {
    // The seed's TikTok and Instagram are ready and never warmed. Give them
    // histories, and add a new account and a stale one.
    const seeded = await adapter.listCampaignAccounts(INFLOW_CAMPAIGN_ID)
    const tiktok = seeded.find((a) => a.platform === 'TikTok')!
    const instagram = seeded.find((a) => a.platform === 'Instagram')!
    await warmedDaysAgo(tiktok.id, 1) // ready, fresh
    await warmedDaysAgo(instagram.id, 20) // ready, but left alone for weeks
    await account('Facebook', '@brandnew', 'new')
    const half = await account('X', '@halfway', 'warming')
    await warmedDaysAgo(half.id, 2) // mid-way and recent

    renderScreen()
    const platforms = await order()

    // Overdue first, then new, then in-progress, then ready-and-fresh.
    expect(platforms).toEqual(['Instagram', 'Facebook', 'X', 'TikTok'])
  })

  it('paints the top group red and says why in words', async () => {
    const seeded = await adapter.listCampaignAccounts(INFLOW_CAMPAIGN_ID)
    const instagram = seeded.find((a) => a.platform === 'Instagram')!
    await warmedDaysAgo(instagram.id, 20)
    await account('Facebook', '@brandnew', 'new')

    renderScreen()
    await screen.findByText(/Keep them warm/)

    const fresh = screen.getByText('New - not warmed yet')
    expect(fresh).toHaveClass('text-state-blocked')
    const stale = screen.getByText('Overdue - 20 days, limit 2')
    expect(stale).toHaveClass('text-state-blocked')
    // Overdue and new are separate sections, both red.
    expect(screen.getByText(/Warm up urgently - 2/)).toHaveClass('text-state-blocked')
    expect(screen.getByText(/Warm these first - 1/)).toHaveClass('text-state-blocked')
  })

  it('treats a ready account that was never warmed as neglected, not as fine', async () => {
    renderScreen()
    await screen.findByText(/Keep them warm/)

    // The seed's two ready accounts have no sessions on record.
    expect(screen.getAllByText('Never warmed')).toHaveLength(2)
    expect(screen.getByText(/Warm up urgently - 2/)).toBeInTheDocument()
    expect(screen.queryByText(/Ready - keeping them fresh/)).toBeNull()
  })

  it('leaves a ready account that was warmed recently at the bottom, in grey', async () => {
    for (const a of await adapter.listCampaignAccounts(INFLOW_CAMPAIGN_ID)) {
      await warmedDaysAgo(a.id, 1)
    }
    await account('Facebook', '@brandnew', 'new')

    renderScreen()
    const platforms = await order()

    expect(platforms[0]).toBe('Facebook')
    expect(screen.getByText(/Ready - keeping them fresh/)).toBeInTheDocument()
    expect(screen.getAllByText('yesterday')).toHaveLength(2)
    expect(screen.getAllByText('yesterday')[0]).toHaveClass('text-state-later')
    // Nothing red beyond the new account.
    expect(screen.getByText(/Warm these first - 1/)).toBeInTheDocument()
  })

  it('orders the neglected by how long they have been left, longest first', async () => {
    const seeded = await adapter.listCampaignAccounts(INFLOW_CAMPAIGN_ID)
    const tiktok = seeded.find((a) => a.platform === 'TikTok')!
    const instagram = seeded.find((a) => a.platform === 'Instagram')!
    await warmedDaysAgo(tiktok.id, 9)
    await warmedDaysAgo(instagram.id, 30)

    renderScreen()
    await screen.findByText(/Keep them warm/)

    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Instagram')
    expect(rows[0]).toHaveTextContent('Overdue - 30 days, limit 2')
    expect(rows[1]).toHaveTextContent('Overdue - 9 days, limit 2')
  })
})

describe('the warm-up list, best-paying campaign first', () => {
  async function campaignPaying(name: string, cents: number, platform: string) {
    const campaign = await adapter.createCampaign({
      name,
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      daily_post_quota: 1,
      pay_per_video_cents: cents,
      cycle_size: null,
    })
    await adapter.addCampaignAccount({
      campaign_id: campaign.id,
      platform,
      handle: `@${name.toLowerCase()}`,
      status: 'new',
    })
    return campaign
  }

  it('lists the campaign that pays best first within a group', async () => {
    // Inflow is the seed's, $35. All three of these are new, so they share the
    // red group and pay alone decides the order.
    for (const a of await adapter.listCampaignAccounts(INFLOW_CAMPAIGN_ID)) {
      await adapter.updateCampaignAccount(a.id, { status: 'new' })
    }
    await campaignPaying('Cheap', 1000, 'Facebook')
    await campaignPaying('Rich', 9000, 'X')

    renderScreen()
    await screen.findByText(/Keep them warm/)

    const rows = screen.getAllByRole('listitem').map((row) => row.textContent ?? '')
    const first = rows.findIndex((text) => text.includes('Rich'))
    const second = rows.findIndex((text) => text.includes('Inflow'))
    const last = rows.findIndex((text) => text.includes('Cheap'))
    expect(first).toBeLessThan(second)
    expect(second).toBeLessThan(last)
  })

  it('still keeps neglected accounts above fresh ones - pay only orders inside a group', async () => {
    // A rich campaign whose account is ready and warmed recently belongs in the
    // grey group, below a cheap campaign's brand-new account in the red one.
    const rich = await campaignPaying('Rich', 9000, 'X')
    const [richAccount] = await adapter.listCampaignAccounts(rich.id)
    await adapter.updateCampaignAccount(richAccount.id, { status: 'ready' })
    const event = await adapter.recordWarmupEvent(richAccount.id, 5)
    void event
    await campaignPaying('Cheap', 1000, 'Facebook')

    renderScreen()
    await screen.findByText(/Keep them warm/)

    const rows = screen.getAllByRole('listitem').map((row) => row.textContent ?? '')
    // Warmed today puts Rich in the done group; the point is that Cheap's new
    // account is not pushed below it by pay.
    expect(rows.findIndex((t) => t.includes('Cheap'))).toBeLessThan(
      rows.findIndex((t) => t.includes('Rich')),
    )
  })
})

describe('the work clock', () => {
  beforeEach(() => localStorage.clear())

  it('shows nothing beside the time until he starts', async () => {
    renderScreen()
    await screen.findByText(/of 1/)
    expect(screen.getByRole('button', { name: 'Start working' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Time worked today')).toBeNull()
  })

  it('opens from the time itself and starts counting', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText(/of 1/)

    await user.click(screen.getByRole('button', { name: 'Start working' }))
    expect(await screen.findByLabelText('Time worked today')).toHaveTextContent('00:00')

    await user.click(screen.getByRole('button', { name: 'START WORKING' }))
    expect(screen.getByRole('button', { name: 'PAUSE' })).toBeInTheDocument()
  })

  it('keeps running when he leaves, and shows the figure beside the time', async () => {
    // The whole point: "i dont want it to reset when i leave the now page".
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText(/of 1/)

    await user.click(screen.getByRole('button', { name: 'Start working' }))
    await user.click(screen.getByRole('button', { name: 'START WORKING' }))
    await user.click(screen.getByRole('button', { name: 'Leave it running' }))

    // Back on the home screen, the clock button now reports the stretch.
    expect(await screen.findByRole('button', { name: /^Working - / })).toBeInTheDocument()
  })

  it('survives the screen being torn down and rebuilt', async () => {
    const user = userEvent.setup()
    const first = renderScreen()
    await screen.findByText(/of 1/)
    await user.click(screen.getByRole('button', { name: 'Start working' }))
    await user.click(screen.getByRole('button', { name: 'START WORKING' }))
    first.unmount()

    // A reload reads the stretch back off storage rather than starting again.
    renderScreen()
    expect(await screen.findByRole('button', { name: /^Working - / })).toBeInTheDocument()
  })

  it('banks the time when paused, and offers it back', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText(/of 1/)

    await user.click(screen.getByRole('button', { name: 'Start working' }))
    await user.click(screen.getByRole('button', { name: 'START WORKING' }))
    await user.click(screen.getByRole('button', { name: 'PAUSE' }))

    expect(screen.getByRole('button', { name: 'BACK TO WORK' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear today' })).toBeInTheDocument()
  })
})

describe('the streak', () => {
  async function postOn(daysAgo: number) {
    const video = await adapter.createVideo({
      campaign_id: INFLOW_CAMPAIGN_ID,
      setup: 'face',
      angle_id: null,
      script: null,
      blocked_reason: null,
      owed_for_date: null,
      rate_snapshot_cents: null,
      posted_at: null,
    })
    const when = new Date()
    when.setDate(when.getDate() - daysAgo)
    when.setHours(12, 0, 0, 0)
    const accounts = await adapter.listCampaignAccounts(INFLOW_CAMPAIGN_ID)
    await adapter.addVideoPost({
      video_id: video.id,
      account_id: accounts[0].id,
      platform: accounts[0].platform,
      url: null,
      view_count: null,
      view_count_entered_at: null,
      posted_at: when.toISOString(),
    })
  }

  it('says nothing at all before there is one', async () => {
    renderScreen()
    await screen.findByText(/of 1/)
    expect(screen.queryByText(/running/)).toBeNull()
  })

  it('counts the days running once he has posted', async () => {
    for (const daysAgo of [2, 1, 0]) await postOn(daysAgo)

    renderScreen()
    expect(await screen.findByText('3 days running')).toBeInTheDocument()
  })

  it('stays alive while today is still empty', async () => {
    // Not broken until a whole day is missed - that is the pressure.
    for (const daysAgo of [2, 1]) await postOn(daysAgo)

    renderScreen()
    expect(await screen.findByText('2 days running')).toBeInTheDocument()
  })

  it('says one day, not one days', async () => {
    await postOn(0)
    renderScreen()
    expect(await screen.findByText('1 day running')).toBeInTheDocument()
  })
})

describe('editing, without a session', () => {
  it('shows nothing to edit when nothing has been filmed', async () => {
    renderScreen()
    await screen.findByText(/of 1/)
    expect(screen.queryByText(/ready to edit/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mark edited' })).toBeNull()
  })

  it('marks the oldest filmed video edited in one tap, no goal or timer involved', async () => {
    const video = await filmOne()

    const user = userEvent.setup()
    renderScreen()
    await screen.findByText(/of 1/)

    expect(await screen.findByText('1 filmed, ready to edit')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mark edited' }))

    await waitFor(async () => {
      expect((await adapter.getVideo(video.id))?.phase).toBe('edited')
    })
    await waitFor(() => {
      expect(screen.queryByText(/ready to edit/)).toBeNull()
    })
  })
})

describe('filming against a goal', () => {
  it('shows the never-do list, then counts filmed videos off the goal', async () => {
    await adapter.addCampaignRule({
      campaign_id: INFLOW_CAMPAIGN_ID,
      body: 'Never say the brand name twice.',
    })

    const user = userEvent.setup()
    renderScreen()
    await screen.findByText(/of 1/)

    await user.click(screen.getByRole('button', { name: 'FILM' }))
    await user.click(await screen.findByRole('button', { name: /Inflow/ }))

    expect(await screen.findByText('Never say the brand name twice.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start filming' }))

    // Seven is the default, and there is no clock beside it.
    expect(await screen.findByText('of 7')).toBeInTheDocument()
    expect(screen.queryByLabelText('Elapsed')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Filmed one' }))
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())
  })

  it('lets him set his own goal rather than taking the preset', async () => {
    const user = userEvent.setup()
    renderScreen()
    await screen.findByText(/of 1/)

    await user.click(screen.getByRole('button', { name: 'FILM' }))
    await user.click(await screen.findByRole('button', { name: /Inflow/ }))
    await user.type(await screen.findByLabelText('or type a number'), '4')
    await user.click(screen.getByRole('button', { name: 'Start filming' }))

    expect(await screen.findByText('of 4')).toBeInTheDocument()
  })

  it('offers a campaign whose accounts are still warming up', async () => {
    // Warm-up is a caution about posting, never a reason to refuse to let him
    // film. The old screen hid the campaign entirely.
    const fresh = await adapter.createCampaign({
      name: 'Brand new campaign',
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      pay_per_video_cents: 1000,
      cycle_size: null,
    })
    await adapter.addCampaignAccount({
      campaign_id: fresh.id,
      platform: 'TikTok',
      handle: '@brandnew',
    })

    const user = userEvent.setup()
    renderScreen()
    await screen.findByText(/of 1/)
    await user.click(screen.getByRole('button', { name: 'FILM' }))

    expect(await screen.findByRole('button', { name: /Brand new campaign/ })).toBeInTheDocument()
  })
})

describe('warming up an account', () => {
  async function freshAccount(platform = 'TikTok', handle = '@brandnew') {
    const campaign = await adapter.createCampaign({
      name: 'Brand new campaign',
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      pay_per_video_cents: 1000,
      cycle_size: null,
    })
    const account = await adapter.addCampaignAccount({
      campaign_id: campaign.id,
      platform,
      handle,
    })
    return { campaign, account }
  }

  it('keeps ready accounts on the list too, so they do not go stale', async () => {
    // "keep a warmup section for all accounts just to make sure i keep them
    // fresh and remember". The seed's two are ready, and both belong here.
    renderScreen()
    expect(await screen.findByText(/Keep them warm/)).toBeInTheDocument()
    expect(screen.getByText('TikTok')).toBeInTheDocument()
    expect(screen.getByText('Instagram')).toBeInTheDocument()
    // Never warmed, so neglected - but still a shorter sitting than an
    // account being built.
    expect(screen.getAllByText('Never warmed')).toHaveLength(2)
    // Nothing done yet, so there is no done group at all.
    expect(screen.queryByText('Warmed today')).toBeNull()
  })

  it('names the accounts that are not ready, and puts them first', async () => {
    // The count on its own ("Warm up 2 accounts") made him tap to find out
    // which. The point of this list is reading it without tapping.
    await freshAccount('Facebook', '@brandnew')

    renderScreen()
    expect(await screen.findByText(/Keep them warm/)).toBeInTheDocument()
    expect(screen.getByText(/@brandnew/)).toBeInTheDocument()

    // In the same red group as the two never-warmed Inflow accounts. Inflow
    // ($35) pays more than this campaign ($10), so it is listed first.
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[2]).toHaveTextContent('Facebook')
  })

  it('drops a handle whose campaign is gone, even one orphaned before the fix', async () => {
    // His report: "i still have karimssn1 handle to warmup even if i deleted
    // the campaign. And i don't want to see it." deleteCampaign now takes the
    // accounts down too, but rows orphaned by an earlier delete are already in
    // his store - so the list refuses them on sight rather than only new ones.
    const { account } = await freshAccount('TikTok', '@karimssn1')
    await adapter.updateCampaign(account.campaign_id, { is_active: false })
    // Deliberately still active, the way an earlier delete would have left it.
    expect((await adapter.listCampaignAccounts()).some((a) => a.id === account.id)).toBe(true)

    renderScreen()
    await screen.findByText(/Keep them warm/)
    expect(screen.queryByText(/@karimssn1/)).toBeNull()
  })

  it('leaves YouTube out of it entirely', async () => {
    // "youtube accounts dont need to warmup so remove them from warmups." It
    // is brand new and never warmed, and still does not belong on this list.
    await adapter.addCampaignAccount({
      campaign_id: INFLOW_CAMPAIGN_ID,
      platform: 'YouTube',
      handle: '@michael.yt',
    })

    renderScreen()
    await screen.findByText(/Keep them warm/)
    expect(screen.queryByText('YouTube')).toBeNull()
    expect(screen.queryByText(/@michael\.yt/)).toBeNull()
  })

  it('offers a time to start at, preselected to the usual length', async () => {
    const { account } = await freshAccount()
    void account

    const user = userEvent.setup()
    renderScreen()
    await screen.findByText(/of 1/)
    await user.click(await screen.findByRole('button', { name: /TikTok.*@brandnew/ }))

    // Building, so 15 is the usual length - offered, and already selected.
    const usual = await screen.findByRole('button', { name: '15 min - usual' })
    expect(usual).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Start - 15 min' })).toBeInTheDocument()
    // Nothing has started yet - no countdown, no timer on the strip.
    expect(screen.queryByText('15:00')).toBeNull()
  })

  it('starts at the usual length with one tap on Start', async () => {
    const { account } = await freshAccount()

    const user = userEvent.setup()
    renderScreen()
    await screen.findByText(/of 1/)
    await user.click(await screen.findByRole('button', { name: /TikTok.*@brandnew/ }))
    await user.click(await screen.findByRole('button', { name: 'Start - 15 min' }))

    expect(await screen.findByText('15:00')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Mark warmed up' }))

    await waitFor(async () => {
      const events = await adapter.listWarmupEvents()
      expect(events.filter((e) => e.account_id === account.id)).toHaveLength(1)
    })
  })

  it('gives a ready account five minutes by default, and logs it as five', async () => {
    const accounts = await adapter.listCampaignAccounts(INFLOW_CAMPAIGN_ID)
    const tiktok = accounts.find((a) => a.platform === 'TikTok')!

    const user = userEvent.setup()
    renderScreen()
    await screen.findByText(/of 1/)
    await user.click(await screen.findByRole('button', { name: /TikTok/ }))
    await user.click(await screen.findByRole('button', { name: 'Start - 5 min' }))

    expect(await screen.findByText('05:00')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mark warmed up' }))

    await waitFor(async () => {
      const events = await adapter.listWarmupEvents()
      expect(events.find((e) => e.account_id === tiktok.id)?.minutes).toBe(5)
    })
    // It was already ready and stays ready - warming it is maintenance.
    const after = await adapter.listCampaignAccounts(INFLOW_CAMPAIGN_ID)
    expect(after.find((a) => a.id === tiktok.id)?.status).toBe('ready')

    // And it moves into the done group, leaving one still to do.
    expect(await screen.findByText('Warmed today')).toBeInTheDocument()
    expect(await screen.findByText('warmed')).toBeInTheDocument()
    expect(screen.getByText(/Keep them warm - 1 left/)).toBeInTheDocument()
  })

  it('lets him pick a different length with a tap, and logs the one he picked', async () => {
    const accounts = await adapter.listCampaignAccounts(INFLOW_CAMPAIGN_ID)
    const tiktok = accounts.find((a) => a.platform === 'TikTok')!

    const user = userEvent.setup()
    renderScreen()
    await screen.findByText(/of 1/)
    await user.click(await screen.findByRole('button', { name: /TikTok/ }))
    await user.click(await screen.findByRole('button', { name: '20 min' }))
    await user.click(await screen.findByRole('button', { name: 'Start - 20 min' }))

    expect(await screen.findByText('20:00')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mark warmed up' }))

    await waitFor(async () => {
      const events = await adapter.listWarmupEvents()
      expect(events.find((e) => e.account_id === tiktok.id)?.minutes).toBe(20)
    })
  })

  it('lets him type a length that is not one of the quick choices', async () => {
    const { account } = await freshAccount()

    const user = userEvent.setup()
    renderScreen()
    await screen.findByText(/of 1/)
    await user.click(await screen.findByRole('button', { name: /TikTok.*@brandnew/ }))

    const input = await screen.findByLabelText('Minutes to warm up for')
    await user.clear(input)
    await user.type(input, '7')
    await user.click(screen.getByRole('button', { name: 'Start - 7 min' }))

    expect(await screen.findByText('07:00')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mark warmed up' }))

    await waitFor(async () => {
      const events = await adapter.listWarmupEvents()
      expect(events.find((e) => e.account_id === account.id)?.minutes).toBe(7)
    })
  })

  it('separates what is done today from what is left', async () => {
    // "when a video is warmed up for the day put it in green and separate the
    // warm and not warm accounts."
    const accounts = await adapter.listCampaignAccounts(INFLOW_CAMPAIGN_ID)
    const tiktok = accounts.find((a) => a.platform === 'TikTok')!
    await adapter.recordWarmupEvent(tiktok.id, 5)

    renderScreen()
    expect(await screen.findByText('Warmed today')).toBeInTheDocument()
    expect(screen.getByText(/Keep them warm - 1 left/)).toBeInTheDocument()

    // The done one sits under the done heading, the other under what is left.
    const groups = screen.getAllByRole('list')
    expect(groups).toHaveLength(2)
    expect(groups[0]).toHaveTextContent('Instagram')
    expect(groups[1]).toHaveTextContent('TikTok')
  })

  it('drops the "what is left" heading once everything is done', async () => {
    for (const account of await adapter.listCampaignAccounts(INFLOW_CAMPAIGN_ID)) {
      await adapter.recordWarmupEvent(account.id, 5)
    }

    renderScreen()
    expect(await screen.findByText('Warmed today')).toBeInTheDocument()
    expect(screen.queryByText(/Keep them warm/)).toBeNull()
  })

  it('promotes an account to ready after two sessions, and drops it off the list', async () => {
    const { account } = await freshAccount()

    const status = async () =>
      (await adapter.listCampaignAccounts()).find((a) => a.id === account.id)?.status

    await adapter.recordWarmupEvent(account.id, 15)
    expect(await status()).toBe('warming')

    await adapter.recordWarmupEvent(account.id, 15)
    expect(await status()).toBe('ready')

    renderScreen()
    await screen.findByText(/of 1/)
    // Still listed - every account is - but as maintenance rather than as
    // something holding a campaign back.
    expect(await screen.findByText(/@brandnew/)).toBeInTheDocument()
  })

  it('never demotes an account he marked ready himself', async () => {
    const { account } = await freshAccount()
    await adapter.updateCampaignAccount(account.id, { status: 'ready' })

    await adapter.recordWarmupEvent(account.id, 15)

    const accounts = await adapter.listCampaignAccounts()
    expect(accounts.find((a) => a.id === account.id)?.status).toBe('ready')
  })
})
