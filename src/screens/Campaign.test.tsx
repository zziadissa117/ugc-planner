// The campaign page, after it stopped being a brief.
//
// "All I need is to know the account logins." What is left on it: the pay
// (per post and posts a week), the accounts with their logins, and one folded
// "More" holding everything other screens still read. The creative brief and
// hook ideas moved to the FILM console (CreativeBrief.test.tsx).

import 'fake-indexeddb/auto'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { DataContext } from '../data/context'
import type { DataAdapter } from '../data/DataAdapter'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { INFLOW_CAMPAIGN_ID, ensureSeeded } from '../data/seed'
import { Campaign } from './Campaign'

const USER = '11111111-1111-4111-8111-111111111111'

let adapter: DataAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`brief-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
  await ensureSeeded(adapter)
})

async function renderBrief() {
  render(
    <DataContext.Provider value={adapter}>
      <MemoryRouter initialEntries={[`/campaigns/${INFLOW_CAMPAIGN_ID}`]}>
        <Routes>
          <Route path="/campaigns/:campaignId" element={<Campaign />} />
        </Routes>
      </MemoryRouter>
    </DataContext.Provider>,
  )
  await screen.findByRole('heading', { name: 'Inflow' })
}

describe('what the page shows', () => {
  it('leads with the pay and the accounts, and folds everything else', async () => {
    await renderBrief()

    expect(screen.getByText('Accounts')).toBeInTheDocument()
    expect(screen.getByText('per post')).toBeInTheDocument()
    expect(screen.getByText('posts/week')).toBeInTheDocument()
    // The brief fields are not on the page he reads; what the documents said
    // is kept, inside the one fold.
    for (const gone of ['What it is', 'Who it is for', 'How it sounds', 'How the video goes']) {
      expect(screen.queryByText(gone)).toBeNull()
    }
    expect(screen.getByText('More', { selector: 'summary span' }).closest('details')).not.toHaveAttribute('open')
  })

  it('has no hook writer or hooks box - those live in FILM', async () => {
    await renderBrief()

    expect(screen.queryByLabelText('Brief for the hook writer')).toBeNull()
    expect(screen.queryByLabelText('Hooks and ideas')).toBeNull()
  })

  it('does not show the metadata he never needs while filming', async () => {
    await renderBrief()

    // Gone from the app outright.
    for (const gone of [/editing style/i, /default setup/i, /cycle position/i]) {
      expect(screen.queryByText(gone)).toBeNull()
    }

    // Still stored and still editable, but only inside the folded section -
    // never sitting on the page he reads while working.
    for (const noise of [
      /trial/i,
      /aspect ratio/i,
      /wider topic/i,
      /warm.?up/i,
      /angle family/i,
      /opening balance/i,
    ]) {
      for (const element of screen.queryAllByText(noise)) {
        expect(element.closest('details')).not.toBeNull()
      }
    }
  })

  it('has no angles section and nothing asking him to write one', async () => {
    // Angles are optional context, never something to maintain: the seed has
    // eight and the page says nothing about them.
    await renderBrief()

    expect(screen.queryByRole('heading', { name: /angles/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /add angle/i })).toBeNull()
    expect(screen.queryByText(/hook generation has nothing to rotate/i)).toBeNull()
  })

  it('keeps everything else it parsed, inside the fold', async () => {
    await renderBrief()

    const list = screen.getByText(/what the documents said/i)
    expect(list).toBeInTheDocument()
    expect(list.closest('details')).not.toHaveAttribute('open')
  })

  it('keeps the wall of never-do rules folded until asked for', async () => {
    await renderBrief()

    const summary = screen.getByText(/never do - \d+/i)
    expect(summary.closest('details')).not.toHaveAttribute('open')
  })
})

describe('the numbers that decide the day', () => {
  it('shows the rate, the posts owed per week, and what that pays', async () => {
    await renderBrief()

    // Inflow: $35 a post, one a day (seven a week) - so $245 a week, $35 a day.
    expect(screen.getByLabelText('per post')).toHaveTextContent('$35.00')
    expect(screen.getByLabelText('posts/week')).toHaveTextContent('7')
    expect(screen.getByText('per week').parentElement).toHaveTextContent('$245.00')
    expect(screen.getByText('per week').parentElement).toHaveTextContent('about $35.00 a day')
  })

  it('lets the weekly quota be set - no document ever states it', async () => {
    const user = userEvent.setup()
    await renderBrief()

    await user.click(screen.getByLabelText('posts/week'))
    const input = screen.getByLabelText('posts/week')
    await user.clear(input)
    await user.type(input, '5')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(async () => {
      const saved = await adapter.getCampaign(INFLOW_CAMPAIGN_ID)
      expect(saved?.posts_per_week).toBe(5)
      // The Post grid still owes a whole number a day.
      expect(saved?.daily_post_quota).toBe(1)
    })
  })

  it('recalculates what a week pays from the rate and the quota alone', async () => {
    const user = userEvent.setup()
    await renderBrief()

    await user.click(screen.getByLabelText('posts/week'))
    const input = screen.getByLabelText('posts/week')
    await user.clear(input)
    await user.type(input, '3')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // 3 x $35. Nothing about the platform list enters into it.
    await waitFor(() => {
      expect(screen.getByText('$105.00')).toBeInTheDocument()
    })
  })

  it('saves a rate typed in dollars as integer cents, and keeps the field in step', async () => {
    const user = userEvent.setup()
    await renderBrief()

    await user.click(screen.getByLabelText('per post'))
    const input = screen.getByLabelText('per post')
    await user.clear(input)
    await user.type(input, '42.50')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(async () => {
      expect((await adapter.getCampaign(INFLOW_CAMPAIGN_ID))?.pay_per_video_cents).toBe(4250)
    })
    const fields = await adapter.listCampaignFields(INFLOW_CAMPAIGN_ID)
    expect(fields.find((f) => f.field_key === 'pay_per_video_cents')?.field_value).toBe('4250')
  })
})

describe('editing the rate the way a thumb does', () => {
  it('replaces the existing rate when he types, rather than appending to it', async () => {
    const user = userEvent.setup()
    await renderBrief()

    // No clear(): a phone does not select the old value for him.
    await user.click(screen.getByLabelText('per post'))
    await user.keyboard('40')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(async () => {
      expect((await adapter.getCampaign(INFLOW_CAMPAIGN_ID))?.pay_per_video_cents).toBe(4000)
    })
  })

  it('says why when the amount is not one, instead of sitting there', async () => {
    const user = userEvent.setup()
    await renderBrief()

    await user.click(screen.getByLabelText('per post'))
    await user.keyboard('{End}5')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter an amount')
  })
})

describe('renaming a campaign', () => {
  it('edits the title in place and keeps it a heading', async () => {
    const user = userEvent.setup()
    await renderBrief()

    await user.click(screen.getByRole('button', { name: 'Rename Inflow' }))
    const input = screen.getByLabelText('Campaign name')
    await user.clear(input)
    await user.type(input, 'Inflowpay Q4')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(async () => {
      expect((await adapter.getCampaign(INFLOW_CAMPAIGN_ID))?.name).toBe('Inflowpay Q4')
    })
    // Every other screen finds a campaign by its name; making it editable must
    // not cost it the heading role.
    expect(await screen.findByRole('heading', { name: 'Inflowpay Q4' })).toBeInTheDocument()
  })

  it('refuses to save a blank name', async () => {
    const user = userEvent.setup()
    await renderBrief()

    await user.click(screen.getByRole('button', { name: 'Rename Inflow' }))
    await user.clear(screen.getByLabelText('Campaign name'))

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect((await adapter.getCampaign(INFLOW_CAMPAIGN_ID))?.name).toBe('Inflow')
  })
})

describe('notes', () => {
  it('sits with the brief, and saves what he writes', async () => {
    const user = userEvent.setup()
    await renderBrief()

    const row = screen.getByText('Notes').parentElement!.parentElement!
    await user.click(within(row).getByRole('button', { name: 'Edit' }))

    await user.type(screen.getByLabelText('Notes'), 'Brand replies slowly on weekends.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(async () => {
      const fields = await adapter.listCampaignFields(INFLOW_CAMPAIGN_ID)
      const note = fields.find((f) => f.field_key === 'notes')
      expect(note?.field_value).toBe('Brand replies slowly on weekends.')
      // His, always: no document produces a note and no parser writes one.
      expect(note?.source).toBe('user_entered')
    })
  })
})

describe('archiving a campaign', () => {
  it('takes two taps, and the first one can be taken back', async () => {
    const user = userEvent.setup()
    await renderBrief()

    await user.click(screen.getByRole('button', { name: 'Archive this campaign' }))
    expect(screen.getByText(/Archive Inflow\?/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(await adapter.listCampaigns()).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Archive this campaign' })).toBeInTheDocument()
  })

  it('leaves every screen, without destroying what it explains', async () => {
    // Soft, on purpose: its videos carry phase_events, and that log is
    // append-only. A real delete would cascade through the history that
    // explains every figure the app has ever shown.
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
    await renderBrief()
    await user.click(screen.getByRole('button', { name: 'Archive this campaign' }))
    await user.click(screen.getByRole('button', { name: 'Archive it' }))

    await waitFor(async () => {
      expect(await adapter.listCampaigns()).toHaveLength(0)
    })
    // Still there underneath, with its history intact, and restorable.
    expect(await adapter.listCampaigns({ includeInactive: true })).toHaveLength(1)
    expect(await adapter.listArchivedCampaigns()).toHaveLength(1)
    expect(await adapter.getVideo(video.id)).not.toBeNull()
    expect(await adapter.listPhaseEvents({ videoId: video.id })).not.toHaveLength(0)
  })

  it("takes the campaign's accounts with it", async () => {
    // "make sure everything related to it doesnt stay, for example i still
    // have karimssn1 handle to warmup even if i deleted the campaign." An
    // account is where THIS campaign posts, so it cannot outlive it.
    expect(await adapter.listCampaignAccounts()).not.toHaveLength(0)

    const user = userEvent.setup()
    await renderBrief()
    await user.click(screen.getByRole('button', { name: 'Archive this campaign' }))
    await user.click(screen.getByRole('button', { name: 'Archive it' }))

    await waitFor(async () => {
      expect(await adapter.listCampaignAccounts()).toHaveLength(0)
    })
  })
})

describe('the platforms it posts to', () => {
  it('replaces the old handle and login fields entirely', async () => {
    await renderBrief()

    expect(screen.getByText('Accounts')).toBeInTheDocument()
    // The campaign-level login is gone: a login belongs to one account.
    expect(screen.queryByLabelText(/^Email$/)).toBeNull()
    expect(screen.queryByText(/♪ TikTok/)).toBeNull()
    expect(screen.queryByText(/▣ Instagram/)).toBeNull()
  })

  it('adds a platform with its own handle, email and password', async () => {
    const user = userEvent.setup()
    await renderBrief()

    await user.click(within(screen.getByText('Accounts').closest('div')!).getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('button', { name: 'Facebook' }))

    await waitFor(async () => {
      const accounts = await adapter.listCampaignAccounts(INFLOW_CAMPAIGN_ID)
      expect(accounts.map((a) => a.platform)).toContain('Facebook')
    })

    await user.type(screen.getByLabelText('Facebook handle'), '@michael')
    await user.tab()

    await waitFor(async () => {
      const accounts = await adapter.listCampaignAccounts(INFLOW_CAMPAIGN_ID)
      expect(accounts.find((a) => a.platform === 'Facebook')?.handle).toBe('@michael')
    })
  })
})

describe('unreviewed parsed fields', () => {
  it('renders amber until confirmed, and confirms in place', async () => {
    // CLAUDE.md's non-negotiable: a parsed field is amber until he has looked
    // at it. That survives the trim for the fields still on the page.
    await adapter.setCampaignField({
      campaign_id: INFLOW_CAMPAIGN_ID,
      field_key: 'audience',
      field_value: 'Store owners 25-45',
      source: 'parsed_unreviewed',
      source_quote: 'Store owners 25-45',
      source_document_id: null,
    })

    const user = userEvent.setup()
    await renderBrief()

    const value = screen.getByText('Store owners 25-45')
    expect(value).toHaveClass('text-state-waiting')

    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(async () => {
      const fields = await adapter.listCampaignFields(INFLOW_CAMPAIGN_ID)
      expect(fields.find((f) => f.field_key === 'audience')?.confirmed_at).not.toBeNull()
    })
  })
})


describe('what each platform pays', () => {
  it('lets one platform have a rate of its own, saved as integer cents', async () => {
    const user = userEvent.setup()
    await renderBrief()
    await user.click(screen.getByText('More', { selector: 'summary span' }))
    await user.click(await screen.findByRole('button', { name: 'More for TikTok' }))

    const box = await screen.findByLabelText('TikTok pay per post')
    await user.click(box)
    await user.type(box, '25.50')
    await user.tab()

    await waitFor(async () => {
      const tiktok = (await adapter.listCampaignAccounts(INFLOW_CAMPAIGN_ID)).find(
        (a) => a.platform === 'TikTok',
      )
      expect(tiktok?.pay_per_post_cents).toBe(2550)
    })
    // A rate of its own means each platform is paid separately, so the switch
    // reads on without his having touched it.
    // The page reloads after the save; give that room under a loaded test run.
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

  it('clears a platform back to the campaign rate when the box is emptied', async () => {
    const user = userEvent.setup()
    await renderBrief()
    const accounts = await adapter.listCampaignAccounts(INFLOW_CAMPAIGN_ID)
    await adapter.updateCampaignAccount(accounts[0].id, { pay_per_post_cents: 1000 })
    // Re-render with the value in place.
    document.body.innerHTML = ''
    await renderBrief()
    await user.click(await screen.findByRole('button', { name: `More for ${accounts[0].platform}` }))

    const box = await screen.findByLabelText(`${accounts[0].platform} pay per post`)
    await user.clear(box)
    await user.tab()
    await waitFor(async () => {
      const again = (await adapter.listCampaignAccounts(INFLOW_CAMPAIGN_ID)).find((a) => a.id === accounts[0].id)
      expect(again?.pay_per_post_cents).toBeNull()
    })
  })

  it('refuses a rate that is not an amount, and says nothing was saved', async () => {
    const user = userEvent.setup()
    await renderBrief()
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
    await renderBrief()
    expect(screen.queryByText(/- pending/)).toBeNull()
    expect(screen.queryByLabelText('Payout date')).toBeNull()
  })

  it('saves a monthly payout date and shows the latest as pending, then paid', async () => {
    const user = userEvent.setup()
    await renderBrief()

    await user.click(screen.getByRole('button', { name: 'Every month' }))
    const date = await screen.findByLabelText('Payout date')
    // The latest payout has to have fallen due for there to be anything to
    // mark: a date well in the past, monthly, always has one.
    await user.type(date, '2026-09-15')
    await waitFor(async () => {
      expect((await adapter.getCampaign(INFLOW_CAMPAIGN_ID))?.payout_date).toBe('2026-09-15')
    })
    expect((await adapter.getCampaign(INFLOW_CAMPAIGN_ID))?.payout_schedule).toBe('monthly')

    const pending = await screen.findByText(/- pending/)
    expect(pending).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Mark paid' }))
    await waitFor(() => expect(screen.getByText(/- paid/)).toBeInTheDocument())
    expect(await adapter.listCampaignPayouts(INFLOW_CAMPAIGN_ID)).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Mark pending' }))
    await waitFor(() => expect(screen.getByText(/- pending/)).toBeInTheDocument())
    expect(await adapter.listCampaignPayouts(INFLOW_CAMPAIGN_ID)).toHaveLength(0)
  })

  it('forgets the date when the schedule goes back to none', async () => {
    const user = userEvent.setup()
    await renderBrief()
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
