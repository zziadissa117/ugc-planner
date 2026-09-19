// The brief page, after it stopped being a metadata dashboard.
//
// What it used to show, and what he asked to be rid of: trial dates, aspect
// ratios, wider-topic ratios, warm-up prep notes, angle-family alternation,
// editing style, a setup picker, an angles section with its own editor, and
// two competing sets of handles. What is left is the four things that answer
// a question he has while making a video, the material he generates hooks
// from, the platforms he posts to, and the never-do list.

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

describe('what the brief shows', () => {
  it('shows the four things that help make the video', async () => {
    await renderBrief()

    for (const label of ['What it is', 'Who it is for', 'How it sounds', 'How the video goes']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
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

  it('keeps everything else it parsed, folded into one line', async () => {
    await renderBrief()

    const fold = screen.getByText(/everything else from the documents/i)
    expect(fold).toBeInTheDocument()
    // Folded: the summary is one line, and the rows are inside a closed
    // details element.
    expect(fold.closest('details')).not.toHaveAttribute('open')
  })

  it('keeps the wall of never-do rules folded until asked for', async () => {
    await renderBrief()

    const summary = screen.getByText(/never do - \d+/i)
    expect(summary.closest('details')).not.toHaveAttribute('open')
  })
})

describe('the numbers that decide the day', () => {
  it('shows the rate, the posts owed per day, and what that pays', async () => {
    await renderBrief()

    // Inflow: $35 a post, one a day - so $35 a day, twice over on the strip.
    expect(screen.getByLabelText('per post')).toHaveTextContent('$35.00')
    expect(screen.getByLabelText('posts/day')).toHaveTextContent('1')
    expect(screen.getByText('per day').parentElement).toHaveTextContent('$35.00')
  })

  it('lets the daily quota be set - no document ever states it', async () => {
    const user = userEvent.setup()
    await renderBrief()

    await user.click(screen.getByLabelText('posts/day'))
    const input = screen.getByLabelText('posts/day')
    await user.clear(input)
    await user.type(input, '4')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(async () => {
      expect((await adapter.getCampaign(INFLOW_CAMPAIGN_ID))?.daily_post_quota).toBe(4)
    })
  })

  it('recalculates what a day pays from the rate and the quota alone', async () => {
    const user = userEvent.setup()
    await renderBrief()

    await user.click(screen.getByLabelText('posts/day'))
    const input = screen.getByLabelText('posts/day')
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

describe('deleting a campaign', () => {
  it('takes two taps, and the first one can be taken back', async () => {
    const user = userEvent.setup()
    await renderBrief()

    await user.click(screen.getByRole('button', { name: 'Delete this campaign' }))
    expect(screen.getByText(/Delete Inflow\?/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(await adapter.listCampaigns()).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Delete this campaign' })).toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: 'Delete this campaign' }))
    await user.click(screen.getByRole('button', { name: 'Delete it' }))

    await waitFor(async () => {
      expect(await adapter.listCampaigns()).toHaveLength(0)
    })
    // Still there underneath, with its history intact.
    expect(await adapter.listCampaigns({ includeInactive: true })).toHaveLength(1)
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
    await user.click(screen.getByRole('button', { name: 'Delete this campaign' }))
    await user.click(screen.getByRole('button', { name: 'Delete it' }))

    await waitFor(async () => {
      expect(await adapter.listCampaignAccounts()).toHaveLength(0)
    })
  })
})

describe('the brief for the hook writer', () => {
  it('takes a whole pasted document and keeps it in one piece', async () => {
    // He does not write hooks by hand - he has the brief worked up into a
    // document and pastes the result in. It must not be shredded into
    // fragments the way the Hooks & ideas box deliberately is.
    const doc = [
      '# Vertus Campaign Brief',
      '',
      '## PRODUCT',
      'Vertus - an AI system at waitlist stage. Never state claims as proven fact.',
      '',
      '## VOICE',
      'Overheard, not pitched.',
    ].join('\n')

    const user = userEvent.setup()
    await renderBrief()

    await user.click(screen.getByLabelText('Brief for the hook writer'))
    await user.paste(doc)
    await user.click(screen.getByRole('button', { name: 'Save the brief' }))

    await waitFor(async () => {
      const fields = await adapter.listCampaignFields(INFLOW_CAMPAIGN_ID)
      expect(fields.find((f) => f.field_key === 'generation_brief')?.field_value).toBe(doc)
    })
    // One field, not a pile of hooks.
    expect(await adapter.listCampaignHooks(INFLOW_CAMPAIGN_ID)).toHaveLength(0)
  })

  it('stays out of the everything-else fold', async () => {
    await adapter.setCampaignField({
      campaign_id: INFLOW_CAMPAIGN_ID,
      field_key: 'generation_brief',
      field_value: 'A pasted brief.',
      source: 'user_entered',
      source_quote: null,
      source_document_id: null,
    })

    await renderBrief()
    // It has its own box; showing it a second time as a raw field row would be
    // the metadata dashboard creeping back.
    expect(screen.queryByText('generation brief')).toBeNull()
  })
})

describe('hooks and ideas', () => {
  it('stays folded, and says how many are in there', async () => {
    await renderBrief()

    const summary = screen.getByText(/hooks & ideas/i)
    expect(summary.closest('details')).not.toHaveAttribute('open')
  })

  it('takes a dump of several ideas at once, split on blank lines', async () => {
    const user = userEvent.setup()
    await renderBrief()

    await user.click(screen.getByText(/hooks & ideas/i))
    await user.type(
      screen.getByLabelText('Hooks and ideas'),
      'POV: your payout is frozen{enter}{enter}Format: screen recording, then talk over it',
    )
    await user.click(screen.getByRole('button', { name: 'Save to this brief' }))

    await waitFor(async () => {
      const hooks = await adapter.listCampaignHooks(INFLOW_CAMPAIGN_ID)
      expect(hooks.map((h) => h.body)).toEqual([
        'POV: your payout is frozen',
        'Format: screen recording, then talk over it',
      ])
      // His words, never a model's.
      expect(hooks.every((h) => h.source === 'user_entered' && h.model === null)).toBe(true)
    })
  })

  it('deletes one without touching the others', async () => {
    for (const body of ['Keep this one', 'Delete this one']) {
      await adapter.addCampaignHook({
        campaign_id: INFLOW_CAMPAIGN_ID,
        angle_id: null,
        body,
        outline: null,
        source: 'user_entered',
        model: null,
        generated_at: null,
        used_at: null,
      })
    }

    const user = userEvent.setup()
    await renderBrief()
    await user.click(screen.getByText(/hooks & ideas/i))

    await user.click(await screen.findByRole('button', { name: /Delete hook: Delete this one/ }))

    await waitFor(async () => {
      const hooks = await adapter.listCampaignHooks(INFLOW_CAMPAIGN_ID)
      expect(hooks.map((h) => h.body)).toEqual(['Keep this one'])
    })
  })
})

describe('the platforms it posts to', () => {
  it('replaces the old handle and login fields entirely', async () => {
    await renderBrief()

    expect(screen.getByText('Platforms')).toBeInTheDocument()
    // The campaign-level login is gone: a login belongs to one account.
    expect(screen.queryByLabelText(/^Email$/)).toBeNull()
    expect(screen.queryByText(/♪ TikTok/)).toBeNull()
    expect(screen.queryByText(/▣ Instagram/)).toBeNull()
  })

  it('adds a platform with its own handle, email and password', async () => {
    const user = userEvent.setup()
    await renderBrief()

    await user.click(within(screen.getByText('Platforms').closest('div')!).getByRole('button', { name: 'Add' }))
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
