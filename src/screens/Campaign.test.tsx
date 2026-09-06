// The brief page must never present eight angles as one authored list.
//
// The data-layer test already proves the two sets are stored separately. This
// one proves the rendered page keeps them apart, which is where the mistake
// would actually be visible to him: two headed sections, six rows under one
// and two under the other, and no list anywhere containing all eight.

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
  // The page loads its data in an effect, so wait for the heading to arrive.
  await screen.findByRole('heading', { name: 'Inflow' })
}

const BRIEF_ANGLES = [
  'A. Frozen funds',
  'B. Waiting for your own money',
  'C. Your country is not supported',
  'D. Taxes handled',
  'E. The real rate',
  'F. You use it too',
]

const SKILL_FILE_ANGLES = ['Nobody picks up', 'Switching is not a project']

describe('the brief page', () => {
  it('renders the six brief angles and the two skill-file angles in separate lists', async () => {
    await renderBrief()

    const briefList = screen.getByRole('list', { name: /from the brief/i })
    const skillList = screen.getByRole('list', { name: /from your skill file/i })
    expect(briefList).not.toBe(skillList)

    expect(within(briefList).getAllByRole('listitem')).toHaveLength(6)
    expect(within(skillList).getAllByRole('listitem')).toHaveLength(2)

    for (const label of BRIEF_ANGLES) {
      expect(within(briefList).getByText(label)).toBeInTheDocument()
      expect(within(skillList).queryByText(label)).toBeNull()
    }
    for (const label of SKILL_FILE_ANGLES) {
      expect(within(skillList).getByText(label)).toBeInTheDocument()
      expect(within(briefList).queryByText(label)).toBeNull()
    }
  })

  it('has no list anywhere on the page holding all eight angles', async () => {
    await renderBrief()

    const allAngles = [...BRIEF_ANGLES, ...SKILL_FILE_ANGLES]
    for (const list of screen.getAllByRole('list')) {
      const present = allAngles.filter((label) => within(list).queryByText(label) !== null)
      // A list may hold six, or two, but never the merged eight.
      expect(present.length).toBeLessThan(allAngles.length)
    }
  })

  it('says plainly that the skill-file angles are not in the brief', async () => {
    await renderBrief()

    const heading = screen.getByRole('heading', { name: /from your skill file - not in the brief/i })
    expect(heading).toBeInTheDocument()
  })

  it('warns that the brief is incomplete', async () => {
    await renderBrief()
    expect(screen.getByText(/this brief looks incomplete/i)).toBeInTheDocument()
  })

  it('renders a missing field as "not saved yet" rather than blank or guessed', async () => {
    await renderBrief()

    // submission_url is one of the SPEC section 12 blanks.
    const label = screen.getByText('submission url')
    const row = label.closest('div')
    expect(row).not.toBeNull()
    expect(within(row!).getByText('not saved yet')).toBeInTheDocument()
  })
})

describe('fixing what the parser missed', () => {
  it('lets a blank field be filled in by hand, as user entered', async () => {
    const user = userEvent.setup()
    await renderBrief()

    // The label sits in the row's text block; the Edit button is its sibling,
    // so the row itself is one level up.
    const row = screen.getByText('submission url').closest('div')!.parentElement!
    await user.click(within(row).getByRole('button', { name: 'Edit' }))

    await user.type(screen.getByLabelText(/submission url/i), 'https://sideshift.app/submit')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(async () => {
      const fields = await adapter.listCampaignFields(INFLOW_CAMPAIGN_ID)
      const saved = fields.find((f) => f.field_key === 'submission_url')
      expect(saved?.field_value).toBe('https://sideshift.app/submit')
      // His word for it, never a document's.
      expect(saved?.source).toBe('user_entered')
    })
  })

  it('confirms an unreviewed field in place, and fills the pay figure with it', async () => {
    await adapter.setCampaignField({
      campaign_id: INFLOW_CAMPAIGN_ID,
      field_key: 'pay_per_video_cents',
      field_value: '2000',
      source: 'parsed_unreviewed',
      source_quote: '$20.00 per approved deliverable',
      source_document_id: null,
    })

    const user = userEvent.setup()
    await renderBrief()

    await user.click(screen.getAllByRole('button', { name: 'Confirm' })[0])

    await waitFor(async () => {
      const campaign = await adapter.getCampaign(INFLOW_CAMPAIGN_ID)
      expect(campaign?.pay_per_video_cents).toBe(2000)
    })
  })

  it('lets the daily quota be set - no document ever states it', async () => {
    const user = userEvent.setup()
    await renderBrief()

    const row = screen.getByText('posts owed per day').closest('div')!.parentElement!
    await user.click(within(row).getByRole('button', { name: 'Edit' }))

    const input = screen.getByLabelText('posts owed per day')
    await user.clear(input)
    await user.type(input, '2')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(async () => {
      const campaign = await adapter.getCampaign(INFLOW_CAMPAIGN_ID)
      expect(campaign?.daily_post_quota).toBe(2)
    })
  })

  it('keeps the wall of rules folded away until asked for', async () => {
    await renderBrief()

    const summary = screen.getByText(/never do - \d+ rules?/i)
    // The rules are in the DOM for search and for screen readers, but the
    // section is shut: opening the page onto paragraphs of them is what makes
    // it unreadable.
    const details = summary.closest('details')
    expect(details).not.toBeNull()
    expect(details).not.toHaveAttribute('open')
  })
})

describe('the account box', () => {
  it('does not warn when the seed already carries a handle', async () => {
    // Inflow's seed sets handle_tiktok and handle_instagram (user_entered).
    await renderBrief()
    expect(screen.queryByText(/no @ handle saved yet/i)).toBeNull()
  })

  it('warns when no platform handle is saved at all', async () => {
    // A blank campaign with none of the seed's account fields.
    const campaign = await adapter.createCampaign({
      name: 'No handle yet',
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      pay_per_video_cents: null,
      cycle_size: null,
    })
    render(
      <DataContext.Provider value={adapter}>
        <MemoryRouter initialEntries={[`/campaigns/${campaign.id}`]}>
          <Routes>
            <Route path="/campaigns/:campaignId" element={<Campaign />} />
          </Routes>
        </MemoryRouter>
      </DataContext.Provider>,
    )
    await screen.findByRole('heading', { name: 'No handle yet' })
    expect(screen.getByText(/no @ handle saved yet/i)).toBeInTheDocument()
  })

  it('masks the password behind Show/Hide and never shows it by default', async () => {
    const user = userEvent.setup()
    await renderBrief()

    const row = screen.getByText('Password').closest('div')!.parentElement!
    await user.click(within(row).getByRole('button', { name: 'Edit' }))

    const input = screen.getByLabelText('Password')
    expect(input).toHaveAttribute('type', 'password')

    await user.type(input, 'hunter2')
    await user.click(within(row).getByRole('button', { name: 'Show' }))
    expect(input).toHaveAttribute('type', 'text')

    await user.click(screen.getByRole('button', { name: 'Save' }))

    // The edit form closes only once the save (and the reload after it) has
    // actually landed, so waiting for it gone is waiting for the write too.
    await waitFor(() => expect(screen.queryByLabelText('Password')).toBeNull())

    const fields = await adapter.listCampaignFields(INFLOW_CAMPAIGN_ID)
    expect(fields.find((f) => f.field_key === 'account_password')?.field_value).toBe('hunter2')

    // Back to the resting view: hidden again, not the raw password.
    expect(screen.queryByText('hunter2')).toBeNull()
    expect(screen.getByText((text) => text.includes('••••••••'))).toBeInTheDocument()
  })

  it('keeps account fields out of the everything-else lists below', async () => {
    await renderBrief()

    // handle_tiktok/handle_instagram live in the Account box only - listing
    // them again under Saved would be the same fact told twice.
    expect(screen.queryByText('handle tiktok')).toBeNull()
    expect(screen.queryByText('handle instagram')).toBeNull()
  })
})

// The two editors that did not exist. Without a setup the fitting algorithm
// has no honest cost for a video and drops it silently, so a campaign added by
// hand could never produce a session list at all. And editing_style is in
// NEVER_PARSED_FIELDS, so the parser will not write it - yet the brief page
// could only edit field rows that already existed, which made the EDIT
// screen's "add it on the brief page" an instruction nobody could follow.
describe('how you make it', () => {
  it('sets the default setup, which is what makes a campaign plannable', async () => {
    const user = userEvent.setup()
    await renderBrief()

    await user.click(screen.getByRole('button', { name: 'screen' }))

    await waitFor(async () => {
      const campaign = await adapter.getCampaign(INFLOW_CAMPAIGN_ID)
      expect(campaign?.default_setup).toBe('screen')
    })
  })

  it('says plainly when no setup is set, because nothing will schedule', async () => {
    const campaign = await adapter.createCampaign({
      name: 'No setup yet',
      company: null,
      default_setup: null,
      approval_mode: 'none',
      pay_per_video_cents: null,
      cycle_size: null,
    })
    render(
      <DataContext.Provider value={adapter}>
        <MemoryRouter initialEntries={[`/campaigns/${campaign.id}`]}>
          <Routes>
            <Route path="/campaigns/:campaignId" element={<Campaign />} />
          </Routes>
        </MemoryRouter>
      </DataContext.Provider>,
    )
    await screen.findByRole('heading', { name: 'No setup yet' })

    expect(screen.getByText(/cannot be planned into a session/i)).toBeInTheDocument()
  })

  it('lets the editing style be written by hand, as his own words', async () => {
    const user = userEvent.setup()
    await renderBrief()

    const row = screen.getByText('Editing style').closest('div')!.parentElement!
    await user.click(within(row).getByRole('button', { name: 'Edit' }))

    await user.type(screen.getByLabelText('Editing style'), 'Hard cuts, captions bottom third.')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(async () => {
      const fields = await adapter.listCampaignFields(INFLOW_CAMPAIGN_ID)
      const saved = fields.find((f) => f.field_key === 'editing_style')
      expect(saved?.field_value).toBe('Hard cuts, captions bottom third.')
      // No document states an editing style, so it can only ever be his.
      expect(saved?.source).toBe('user_entered')
    })
  })
})

describe('hooks', () => {
  it('saves a hook he typed, marked as his and not a model\u2019s', async () => {
    const user = userEvent.setup()
    await renderBrief()

    await user.type(
      screen.getByLabelText('New hook'),
      'Your account froze the month you finally had a good month.',
    )
    await user.click(screen.getByRole('button', { name: 'Add hook' }))

    await waitFor(async () => {
      const hooks = await adapter.listCampaignHooks(INFLOW_CAMPAIGN_ID)
      expect(hooks).toHaveLength(1)
      expect(hooks[0].body).toBe('Your account froze the month you finally had a good month.')
      // The constraint that keeps the two apart: a hook he wrote cannot claim
      // a model produced it.
      expect(hooks[0].source).toBe('user_entered')
      expect(hooks[0].model).toBeNull()
    })
  })

  it('ties a hook to an angle, so the family is visible while filming', async () => {
    const user = userEvent.setup()
    await renderBrief()

    await user.type(screen.getByLabelText('New hook'), 'The sale clears in 3 seconds.')
    await user.selectOptions(
      screen.getByLabelText('Angle'),
      screen.getByRole('option', { name: 'B. Waiting for your own money' }),
    )
    await user.click(screen.getByRole('button', { name: 'Add hook' }))

    await waitFor(async () => {
      const [hook] = await adapter.listCampaignHooks(INFLOW_CAMPAIGN_ID)
      expect(hook.angle_id).not.toBeNull()
    })
    // The hook line carries the angle and its family, so alternating FEAR and
    // GREED is visible while filming rather than something to remember.
    expect(
      await screen.findByText(/B\. Waiting for your own money - fear - you wrote this/i),
    ).toBeInTheDocument()
  })
})
