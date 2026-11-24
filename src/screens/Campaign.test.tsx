// The campaign page, now that campaigns are typed in rather than read from
// documents.
//
// What is on it: what it pays, its terms (pay per video, videos a day,
// minimum views, platforms), the accounts with the red warning while there
// are none, the product & hook ideas and the hooks written from them, one
// "More" fold for what Post and the money still read, and archiving. What is
// not: anything that only existed for an uploaded brief or contract.

import 'fake-indexeddb/auto'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { DataContext } from '../data/context'
import type { DataAdapter } from '../data/DataAdapter'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { INFLOW_CAMPAIGN_ID, ensureSeeded } from '../data/seed'
import { GENERATION_BRIEF_KEY } from '../hooks/generateHooks'
import { Campaign } from './Campaign'

// Hook generation reaches the server through getSupabaseClient(); mocked so
// a test decides whether the function is there and what it answers.
const invoke = vi.fn()
let mockClient: { functions: { invoke: typeof invoke } } | null = null
vi.mock('../sync/auth', () => ({
  getSupabaseClient: () => mockClient,
}))

const USER = '11111111-1111-4111-8111-111111111111'

let adapter: DataAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`campaign-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
  await ensureSeeded(adapter)
  mockClient = null
  invoke.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

async function renderCampaign(id = INFLOW_CAMPAIGN_ID, name = 'Inflow') {
  render(
    <DataContext.Provider value={adapter}>
      <MemoryRouter initialEntries={[`/campaigns/${id}`]}>
        <Routes>
          <Route path="/campaigns/:campaignId" element={<Campaign />} />
          <Route path="/campaigns" element={<p>campaigns list</p>} />
        </Routes>
      </MemoryRouter>
    </DataContext.Provider>,
  )
  await screen.findByRole('heading', { name })
}

async function bareCampaign(name = 'Vertus') {
  return adapter.createCampaign({
    name,
    company: null,
    default_setup: 'face',
    pay_per_video_cents: 1000,
    cycle_size: null,
    posts_per_week: 14,
  })
}

describe('what the page shows', () => {
  it('leads with what a day pays, then the week and the month', async () => {
    await renderCampaign()

    // Inflow: $35 a post, seven a week.
    const pays = screen.getByText('Pays').parentElement!
    expect(pays).toHaveTextContent('$35.00a day')
    expect(pays).toHaveTextContent('$245.00 a week · $1050.00 a month')
  })

  it('shows the terms: pay per video, videos a day, minimum views, platforms', async () => {
    await renderCampaign()

    expect(screen.getByRole('button', { name: 'Pay per video' })).toHaveTextContent('$35.00')
    expect(screen.getByRole('button', { name: 'Videos a day' })).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: 'Minimum views' })).toHaveTextContent('none')
    const platforms = screen.getByRole('img', { name: /TikTok/ }).getAttribute('aria-label')?.split(', ').sort()
    expect(platforms).toEqual(['Instagram', 'TikTok'])
  })

  it('has nothing left over from uploaded documents', async () => {
    // A parsed field still waiting for him, from before uploads went away.
    await adapter.setCampaignField({
      campaign_id: INFLOW_CAMPAIGN_ID,
      field_key: 'audience',
      field_value: 'Store owners 25-45',
      source: 'parsed_unreviewed',
      source_quote: 'Store owners 25-45',
      source_document_id: null,
    })
    await renderCampaign()

    for (const gone of [
      /update from a new contract/i,
      /what the documents said/i,
      /never do/i,
      /looked incomplete/i,
      /Store owners 25-45/,
      /contract/i,
    ]) {
      expect(screen.queryByText(gone)).toBeNull()
    }
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
    expect(screen.queryByRole('link', { name: /update/i })).toBeNull()
  })

  it('has no angles section and nothing asking him to write one', async () => {
    await renderCampaign()

    expect(screen.queryByRole('heading', { name: /angles/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /add angle/i })).toBeNull()
  })

  it('folds what Post and the money read into "More"', async () => {
    await renderCampaign()

    const more = screen.getByText('More', { selector: 'summary span' }).closest('details')!
    expect(more).not.toHaveAttribute('open')
    for (const setting of ['Each platform pays separately', 'Videos need to be submitted']) {
      expect(within(more).getByRole('button', { name: setting })).toBeInTheDocument()
    }
    expect(within(more).getByRole('group', { name: 'Payout schedule' })).toBeInTheDocument()
    expect(within(more).getByLabelText('Pay per month for Inflow')).toBeInTheDocument()
    expect(within(more).getByLabelText('Notes')).toBeInTheDocument()
  })

  it('says "not saved yet" where there is no rate, rather than a number', async () => {
    await adapter.updateCampaign(INFLOW_CAMPAIGN_ID, { pay_per_video_cents: null })
    await renderCampaign()

    expect(screen.getByRole('button', { name: 'Pay per video' })).toHaveTextContent('not saved yet')
    expect(screen.getByText('Pays').parentElement).toHaveTextContent('not saved yet')
  })
})

describe('the terms', () => {
  it('asks videos a day and stores a week of them', async () => {
    const user = userEvent.setup()
    await renderCampaign()

    await user.click(screen.getByRole('button', { name: 'Videos a day' }))
    await user.keyboard('3')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(async () => {
      const saved = await adapter.getCampaign(INFLOW_CAMPAIGN_ID)
      expect(saved?.posts_per_week).toBe(21)
      expect(saved?.daily_post_quota).toBe(3)
    })
    // 3 x $35 a day. Nothing about the platform list enters into it.
    expect(await screen.findByText('$105.00')).toBeInTheDocument()
  })

  it('shows a week that is not a whole number of days as it is', async () => {
    await adapter.updateCampaign(INFLOW_CAMPAIGN_ID, { posts_per_week: 5 })
    await renderCampaign()

    expect(screen.getByRole('button', { name: 'Videos a day' })).toHaveTextContent('5 a week')
  })

  it('refuses zero or nothing for videos a day, and says why', async () => {
    const user = userEvent.setup()
    await renderCampaign()

    await user.click(screen.getByRole('button', { name: 'Videos a day' }))
    await user.keyboard('0')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a whole number of videos a day.')

    await user.clear(screen.getByLabelText('Videos a day'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect((await adapter.getCampaign(INFLOW_CAMPAIGN_ID))?.posts_per_week).toBe(7)
  })

  it('replaces the rate when he types, rather than appending to it, as integer cents', async () => {
    const user = userEvent.setup()
    await renderCampaign()

    // No clear(): a phone does not select the old value for him.
    await user.click(screen.getByRole('button', { name: 'Pay per video' }))
    await user.keyboard('42.50')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(async () => {
      expect((await adapter.getCampaign(INFLOW_CAMPAIGN_ID))?.pay_per_video_cents).toBe(4250)
    })
    const fields = await adapter.listCampaignFields(INFLOW_CAMPAIGN_ID)
    expect(fields.find((f) => f.field_key === 'pay_per_video_cents')?.field_value).toBe('4250')
  })

  it('says why when the rate is not an amount, instead of sitting there', async () => {
    const user = userEvent.setup()
    await renderCampaign()

    await user.click(screen.getByRole('button', { name: 'Pay per video' }))
    await user.keyboard('{End}5')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter an amount')
  })

  it('sets a minimum number of views and takes it off again', async () => {
    const user = userEvent.setup()
    await renderCampaign()

    await user.click(screen.getByRole('button', { name: 'Minimum views' }))
    await user.keyboard('2.5k')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect((await adapter.getCampaign(INFLOW_CAMPAIGN_ID))?.min_views).toBe(2500))
    expect(await screen.findByText('2,500')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Minimum views' }))
    await user.clear(screen.getByLabelText('Minimum views'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect((await adapter.getCampaign(INFLOW_CAMPAIGN_ID))?.min_views).toBeNull())
  })
})

describe('renaming a campaign', () => {
  it('edits the title in place and keeps it a heading', async () => {
    const user = userEvent.setup()
    await renderCampaign()

    await user.click(screen.getByRole('button', { name: 'Rename Inflow' }))
    const input = screen.getByLabelText('Campaign name')
    await user.clear(input)
    await user.type(input, 'Inflowpay Q4')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(async () => {
      expect((await adapter.getCampaign(INFLOW_CAMPAIGN_ID))?.name).toBe('Inflowpay Q4')
    })
    expect(await screen.findByRole('heading', { name: 'Inflowpay Q4' })).toBeInTheDocument()
  })

  it('refuses to save a blank name', async () => {
    const user = userEvent.setup()
    await renderCampaign()

    await user.click(screen.getByRole('button', { name: 'Rename Inflow' }))
    await user.clear(screen.getByLabelText('Campaign name'))

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect((await adapter.getCampaign(INFLOW_CAMPAIGN_ID))?.name).toBe('Inflow')
  })
})

describe('the accounts', () => {
  const WARNING = "If you're going to run a campaign, add your accounts now. Don't wait."

  it('warns in red when the campaign has none', async () => {
    const vertus = await bareCampaign()
    await renderCampaign(vertus.id, 'Vertus')

    expect(await screen.findByRole('alert')).toHaveTextContent(WARNING)
  })

  it('does not warn once they are in', async () => {
    await renderCampaign()
    await screen.findAllByLabelText(/handle/)
    expect(screen.queryByText(WARNING)).toBeNull()
  })

  it('adds a platform, ready to post from, and takes its username', async () => {
    const user = userEvent.setup()
    await renderCampaign()

    await user.click(within(screen.getByText('Accounts').closest('div')!).getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('button', { name: 'Facebook' }))

    await waitFor(async () => {
      const facebook = (await adapter.listCampaignAccounts(INFLOW_CAMPAIGN_ID)).find((a) => a.platform === 'Facebook')
      expect(facebook?.status).toBe('ready')
    })

    await user.type(screen.getByLabelText('Facebook handle'), '@michael')
    await user.tab()

    await waitFor(async () => {
      const accounts = await adapter.listCampaignAccounts(INFLOW_CAMPAIGN_ID)
      expect(accounts.find((a) => a.platform === 'Facebook')?.handle).toBe('@michael')
    })
  })
})

describe('product & hook ideas', () => {
  it('saves what he types as his own', async () => {
    const user = userEvent.setup()
    await renderCampaign()

    await user.type(screen.getByLabelText('Product and hook ideas'), 'A payments app for small shops.')
    await user.click(screen.getByRole('button', { name: 'Save ideas' }))

    await waitFor(async () => {
      const fields = await adapter.listCampaignFields(INFLOW_CAMPAIGN_ID)
      const ideas = fields.find((f) => f.field_key === GENERATION_BRIEF_KEY)
      expect(ideas?.field_value).toBe('A payments app for small shops.')
      expect(ideas?.source).toBe('user_entered')
    })
  })

  it('says when Claude wrote it from an old brief, until he saves it', async () => {
    await adapter.setCampaignField({
      campaign_id: INFLOW_CAMPAIGN_ID,
      field_key: GENERATION_BRIEF_KEY,
      field_value: 'Written from the brief.',
      source: 'parsed_unreviewed',
      source_quote: null,
      source_document_id: null,
    })
    const user = userEvent.setup()
    await renderCampaign()

    expect(screen.getByLabelText('Product and hook ideas')).toHaveValue('Written from the brief.')
    expect(screen.getByText(/Claude wrote this from your old brief/)).toHaveClass('text-state-waiting')

    await user.click(screen.getByRole('button', { name: 'Save ideas' }))
    await waitFor(async () => {
      const fields = await adapter.listCampaignFields(INFLOW_CAMPAIGN_ID)
      expect(fields.find((f) => f.field_key === GENERATION_BRIEF_KEY)?.source).toBe('user_entered')
    })
    await waitFor(() => expect(screen.queryByText(/Claude wrote this/)).toBeNull())
  })
})

describe('hooks', () => {
  async function addHooks() {
    await adapter.addCampaignHook({
      campaign_id: INFLOW_CAMPAIGN_ID,
      angle_id: null,
      body: 'I stopped chasing invoices.',
      outline: null,
      source: 'user_entered',
      model: null,
      generated_at: null,
      used_at: null,
    })
    await adapter.addCampaignHook({
      campaign_id: INFLOW_CAMPAIGN_ID,
      angle_id: null,
      body: 'Nobody tells you this about getting paid.',
      outline: null,
      source: 'generated',
      model: 'claude-test',
      generated_at: '2026-11-01T00:00:00.000Z',
      used_at: null,
    })
  }

  it('lists them, and says which were generated - never on one he wrote', async () => {
    await addHooks()
    await renderCampaign()

    const list = await screen.findByRole('list', { name: 'Hooks' })
    const mine = within(list).getByText('I stopped chasing invoices.').closest('li')!
    const written = within(list).getByText('Nobody tells you this about getting paid.').closest('li')!
    expect(within(written).getByText('generated')).toBeInTheDocument()
    expect(within(mine).queryByText('generated')).toBeNull()
  })

  it('deletes one', async () => {
    await addHooks()
    const user = userEvent.setup()
    await renderCampaign()

    await user.click(await screen.findByRole('button', { name: /Delete hook: I stopped chasing/ }))
    await waitFor(() => expect(screen.queryByText('I stopped chasing invoices.')).toBeNull())
    expect(await adapter.listCampaignHooks(INFLOW_CAMPAIGN_ID)).toHaveLength(1)
  })

  it('offers no generate button where hook writing is not switched on', async () => {
    await renderCampaign()
    expect(screen.queryByRole('button', { name: 'Write me some hooks' })).toBeNull()
    expect(await screen.findByText('No hooks yet.')).toBeInTheDocument()
  })

  it('writes hooks from the ideas box, with no angles needed, and labels them generated', async () => {
    vi.stubEnv('VITE_GENERATE_HOOKS_DEPLOYED', 'true')
    mockClient = { functions: { invoke } }
    invoke.mockResolvedValue({
      data: {
        hooks: [
          { body: 'Three taps and the shop got paid.', outline: null, angle_id: null },
          { body: 'My accountant asked what changed.', outline: null, angle_id: null },
          { body: 'This is the boring part nobody films.', outline: null, angle_id: null },
        ],
        warnings: [],
        model: 'claude-test-model',
      },
      error: null,
    })
    const bare = await bareCampaign()
    const user = userEvent.setup()
    await renderCampaign(bare.id, 'Vertus')

    // Typed and not saved: the button saves it first, so the hooks come from it.
    await user.type(screen.getByLabelText('Product and hook ideas'), 'A budgeting app for students.')
    await user.click(screen.getByRole('button', { name: 'Write me some hooks' }))

    expect(await screen.findByText('Three taps and the shop got paid.')).toBeInTheDocument()
    const [, request] = invoke.mock.calls[0]
    expect(invoke.mock.calls[0][0]).toBe('generate-hooks')
    expect(request.body.generationBrief).toBe('A budgeting app for students.')
    expect(request.body.angles).toEqual([])
    // Two a day, and a couple spare.
    expect(request.body.count).toBe(4)

    const hooks = await adapter.listCampaignHooks(bare.id)
    expect(hooks).toHaveLength(3)
    expect(hooks.every((h) => h.source === 'generated' && h.model === 'claude-test-model')).toBe(true)
    const row = screen.getByText('Three taps and the shop got paid.').closest('li')!
    expect(within(row).getByText('generated')).toBeInTheDocument()
  })
})

describe('notes', () => {
  it('saves what he writes, as his', async () => {
    const user = userEvent.setup()
    await renderCampaign()

    await user.type(screen.getByLabelText('Notes'), 'Brand replies slowly on weekends.')
    await user.click(screen.getByRole('button', { name: 'Save notes' }))

    await waitFor(async () => {
      const fields = await adapter.listCampaignFields(INFLOW_CAMPAIGN_ID)
      const note = fields.find((f) => f.field_key === 'notes')
      expect(note?.field_value).toBe('Brand replies slowly on weekends.')
      expect(note?.source).toBe('user_entered')
    })
  })
})

describe('archiving a campaign', () => {
  it('takes two taps, and the first one can be taken back', async () => {
    const user = userEvent.setup()
    await renderCampaign()

    await user.click(screen.getByRole('button', { name: 'Archive campaign' }))
    expect(screen.getByText(/Archive Inflow\?/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(await adapter.listCampaigns()).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Archive campaign' })).toBeInTheDocument()
  })

  it('leaves every screen, without destroying what it explains, and takes its accounts with it', async () => {
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

    const user = userEvent.setup()
    await renderCampaign()
    await user.click(screen.getByRole('button', { name: 'Archive campaign' }))
    await user.click(screen.getByRole('button', { name: 'Archive it' }))

    expect(await screen.findByText('campaigns list')).toBeInTheDocument()
    expect(await adapter.listCampaigns()).toHaveLength(0)
    expect(await adapter.listArchivedCampaigns()).toHaveLength(1)
    expect(await adapter.getVideo(video.id)).not.toBeNull()
    expect(await adapter.listPhaseEvents({ videoId: video.id })).not.toHaveLength(0)
    expect(await adapter.listCampaignAccounts()).toHaveLength(0)
  })
})

describe('what each platform pays', () => {
  it('lets one platform have a rate of its own, saved as integer cents', async () => {
    const user = userEvent.setup()
    await renderCampaign()
    await user.click(await screen.findByRole('button', { name: 'More for TikTok' }))

    const box = await screen.findByLabelText('TikTok pay per post')
    await user.click(box)
    await user.type(box, '25.50')
    await user.tab()

    await waitFor(async () => {
      const tiktok = (await adapter.listCampaignAccounts(INFLOW_CAMPAIGN_ID)).find((a) => a.platform === 'TikTok')
      expect(tiktok?.pay_per_post_cents).toBe(2550)
    })
    // A rate of its own means each platform is paid separately, so the switch
    // reads on without his having touched it.
    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: 'Each platform pays separately' })).toHaveAttribute(
          'aria-pressed',
          'true',
        )
      },
      { timeout: 4000 },
    )
  })

  it('refuses a rate that is not an amount, and says nothing was saved', async () => {
    const user = userEvent.setup()
    await renderCampaign()
    await user.click(await screen.findByRole('button', { name: 'More for TikTok' }))
    const box = await screen.findByLabelText('TikTok pay per post')
    await user.type(box, 'lots')
    await user.tab()
    expect(box).toHaveAttribute('aria-invalid', 'true')
    const tiktok = (await adapter.listCampaignAccounts(INFLOW_CAMPAIGN_ID)).find((a) => a.platform === 'TikTok')
    expect(tiktok?.pay_per_post_cents).toBeNull()
  })
})

describe('when the campaign pays', () => {
  it('says nothing is saved until he picks a schedule and a date', async () => {
    await renderCampaign()
    expect(screen.queryByText(/- pending/)).toBeNull()
    expect(screen.queryByLabelText('Payout date')).toBeNull()
  })

  it('saves a monthly payout date and shows the latest as pending, then paid', async () => {
    const user = userEvent.setup()
    await renderCampaign()

    await user.click(screen.getByRole('button', { name: 'Every month' }))
    const date = await screen.findByLabelText('Payout date')
    await user.type(date, '2026-09-15')
    await waitFor(async () => {
      expect((await adapter.getCampaign(INFLOW_CAMPAIGN_ID))?.payout_date).toBe('2026-09-15')
    })
    expect((await adapter.getCampaign(INFLOW_CAMPAIGN_ID))?.payout_schedule).toBe('monthly')

    expect(await screen.findByText(/- pending/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Mark paid' }))
    await waitFor(() => expect(screen.getByText(/- paid/)).toBeInTheDocument())
    expect(await adapter.listCampaignPayouts(INFLOW_CAMPAIGN_ID)).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Mark pending' }))
    await waitFor(() => expect(screen.getByText(/- pending/)).toBeInTheDocument())
    expect(await adapter.listCampaignPayouts(INFLOW_CAMPAIGN_ID)).toHaveLength(0)
  })

  it('forgets the date when the schedule goes back to none', async () => {
    const user = userEvent.setup()
    await renderCampaign()
    await user.click(screen.getByRole('button', { name: 'Once' }))
    await user.type(await screen.findByLabelText('Payout date'), '2026-11-01')
    await waitFor(async () => {
      expect((await adapter.getCampaign(INFLOW_CAMPAIGN_ID))?.payout_date).toBe('2026-11-01')
    })
    await user.click(screen.getByRole('button', { name: 'No payout date' }))
    await waitFor(async () => {
      const row = await adapter.getCampaign(INFLOW_CAMPAIGN_ID)
      expect(row?.payout_schedule).toBe('none')
      expect(row?.payout_date).toBeNull()
    })
  })
})

describe('videos that need submitting', () => {
  it('is his switch, off until he turns it on', async () => {
    const user = userEvent.setup()
    await renderCampaign()

    const toggle = screen.getByRole('button', { name: 'Videos need to be submitted' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await user.click(toggle)
    await waitFor(async () => expect((await adapter.getCampaign(INFLOW_CAMPAIGN_ID))?.needs_submission).toBe(true))
  })
})

// The month figure is an estimate - rate x posts a week x 30/7 - and for some
// deals it is simply wrong (a retainer, pay per completed cycle). So it is
// marked as an estimate until he types the real number, and his number is
// marked as his.
describe('pay per month', () => {
  async function setPay(patch: { pay_per_video_cents: number | null; monthly_pay_override_cents?: number | null }) {
    await adapter.updateCampaign(INFLOW_CAMPAIGN_ID, {
      posts_per_week: 7,
      monthly_pay_override_cents: null,
      ...patch,
    })
  }

  async function openMonth(user: ReturnType<typeof userEvent.setup>) {
    await renderCampaign()
    await user.click(screen.getByText('More', { selector: 'summary span' }))
    return screen.getByLabelText('Pay per month for Inflow')
  }

  function monthRow() {
    return within(screen.getByLabelText('Pay per month for Inflow').parentElement as HTMLElement)
  }

  it('estimates it from the rate and says that it is an estimate', async () => {
    await setPay({ pay_per_video_cents: 3500 })
    const user = userEvent.setup()
    await openMonth(user)

    expect(screen.getByText(/~\$1050\.00\/mo · estimate/)).toBeInTheDocument()
  })

  it('says so plainly when there is no rate to estimate from', async () => {
    await setPay({ pay_per_video_cents: null })
    const user = userEvent.setup()
    await openMonth(user)

    expect(screen.getByText(/tap to set pay per month/)).toBeInTheDocument()
  })

  it('takes his own figure, stores it as integer cents and marks it as his', async () => {
    await setPay({ pay_per_video_cents: 3500 })
    const user = userEvent.setup()
    await user.click(await openMonth(user))
    await user.type(screen.getByLabelText('Pay per month for Inflow'), '1234.56')
    await user.click(monthRow().getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/\$1234\.56\/mo · your figure/)).toBeInTheDocument()
    expect((await adapter.getCampaign(INFLOW_CAMPAIGN_ID))?.monthly_pay_override_cents).toBe(123456)
  })

  it('puts the estimate back when he resets it - null, never zero', async () => {
    await setPay({ pay_per_video_cents: 3500, monthly_pay_override_cents: 200000 })
    const user = userEvent.setup()
    await openMonth(user)
    expect(screen.getByText(/\$2000\.00\/mo · your figure/)).toBeInTheDocument()

    await user.click(screen.getByLabelText('Pay per month for Inflow'))
    await user.click(monthRow().getByRole('button', { name: 'Reset' }))

    expect(await screen.findByText(/~\$1050\.00\/mo · estimate/)).toBeInTheDocument()
    expect((await adapter.getCampaign(INFLOW_CAMPAIGN_ID))?.monthly_pay_override_cents).toBeNull()
  })

  it('refuses something that is not an amount, and offers no reset with nothing to reset', async () => {
    await setPay({ pay_per_video_cents: 3500 })
    const user = userEvent.setup()
    await user.click(await openMonth(user))
    expect(monthRow().queryByRole('button', { name: 'Reset' })).toBeNull()

    await user.type(screen.getByLabelText('Pay per month for Inflow'), 'about two grand')
    await user.click(monthRow().getByRole('button', { name: 'Save' }))

    expect(screen.getByText(/Enter an amount/)).toBeInTheDocument()
  })
})
