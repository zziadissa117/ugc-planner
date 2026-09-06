// Re-briefing Inflow: a rate that changed, a new field, a new rule - all
// through the review screen, none of it silently applied.

import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { DataContext } from '../data/context'
import type { DataAdapter } from '../data/DataAdapter'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { INFLOW_CAMPAIGN_ID, ensureSeeded } from '../data/seed'
import { UpdateCampaign } from './UpdateCampaign'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: DataAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`update-screen-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
  await ensureSeeded(adapter)
})

async function renderScreen() {
  render(
    <DataContext.Provider value={adapter}>
      <MemoryRouter initialEntries={[`/campaigns/${INFLOW_CAMPAIGN_ID}/update`]}>
        <Routes>
          <Route path="/campaigns/:campaignId/update" element={<UpdateCampaign />} />
        </Routes>
      </MemoryRouter>
    </DataContext.Provider>,
  )
  await screen.findByRole('heading', { name: 'Update Inflow' })
}

/** A pasted-JSON result the offline path accepts, shaped like PASTE_SCHEMA_EXAMPLE. */
function pasteResult(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    campaign: { name: 'Inflow', company: 'Inflowpay', approval_mode: null },
    fields: {},
    bonus_tiers: [],
    rules: [],
    brief_is_incomplete: false,
    warnings: [],
    ...overrides,
  })
}

describe('updating an existing campaign', () => {
  // verifyQuotes refuses any field whose quote cannot be found verbatim in a
  // supplied document - the same mechanism that stops the parser inventing a
  // rate. So a test proving a field is genuinely accepted has to supply real
  // document text the quote actually appears in, exactly like a real re-brief.
  const NEW_BRIEF =
    'Per-post compensation: $40.00 per approved deliverable. YouTube added as a required platform this cycle. Every video also carries #ad.'

  it('flags a changed, confirmed field as a conflict rather than applying it', async () => {
    const user = userEvent.setup()
    await renderScreen()

    await user.click(screen.getByLabelText('NEW BRIEF (.md) text'))
    await user.paste(NEW_BRIEF)
    await user.click(screen.getByLabelText('Parsed JSON'))
    await user.paste(
      pasteResult({
        fields: {
          pay_per_video_cents: { value: '4000', source_quote: '$40.00 per approved deliverable' },
        },
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Compare with what is saved' }))

    expect(await screen.findByText(/disagrees with what you already confirmed/i)).toBeInTheDocument()
    expect(screen.getByText('3500')).toBeInTheDocument() // the campaign's own column value, shown as "You have".

    await user.click(screen.getByRole('button', { name: 'Apply update' }))

    await waitFor(async () => {
      const campaign = await adapter.getCampaign(INFLOW_CAMPAIGN_ID)
      // Untouched: he never chose "Use new".
      expect(campaign?.pay_per_video_cents).toBe(3500)
    })
  })

  it('applies the new value, as amber, once he chooses Use new', async () => {
    const user = userEvent.setup()
    await renderScreen()

    await user.click(screen.getByLabelText('NEW BRIEF (.md) text'))
    await user.paste(NEW_BRIEF)
    await user.click(screen.getByLabelText('Parsed JSON'))
    await user.paste(
      pasteResult({
        fields: {
          pay_per_video_cents: { value: '4000', source_quote: '$40.00 per approved deliverable' },
        },
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Compare with what is saved' }))
    await screen.findByText(/disagrees with what you already confirmed/i)

    await user.click(screen.getByRole('button', { name: 'Use new' }))
    await user.click(screen.getByRole('button', { name: 'Apply update' }))

    await waitFor(async () => {
      const fields = await adapter.listCampaignFields(INFLOW_CAMPAIGN_ID)
      const rate = fields.find((f) => f.field_key === 'pay_per_video_cents')
      expect(rate?.field_value).toBe('4000')
      // Amber, not documented - a second parse earns the same confirm tap.
      expect(rate?.source).toBe('parsed_unreviewed')
      // The operating column is untouched until he also confirms it on the
      // brief page - exactly how a first-time parse behaves.
      const campaign = await adapter.getCampaign(INFLOW_CAMPAIGN_ID)
      expect(campaign?.pay_per_video_cents).toBe(3500)
    })
  })

  it('adds a brand new field and a new rule without asking, since nothing is at risk', async () => {
    const user = userEvent.setup()
    await renderScreen()

    await user.click(screen.getByLabelText('NEW BRIEF (.md) text'))
    await user.paste(NEW_BRIEF)
    await user.click(screen.getByLabelText('Parsed JSON'))
    await user.paste(
      pasteResult({
        fields: {
          youtube_added: {
            value: 'YouTube added as a required platform this cycle',
            source_quote: 'YouTube added as a required platform this cycle',
          },
        },
        rules: ['Every video also carries #ad.'],
      }),
    )
    await user.click(screen.getByRole('button', { name: 'Compare with what is saved' }))

    expect(await screen.findByText(/new in this document/i)).toBeInTheDocument()
    expect(screen.getByText(/new rules/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Apply update' }))

    await waitFor(async () => {
      const fields = await adapter.listCampaignFields(INFLOW_CAMPAIGN_ID)
      expect(fields.find((f) => f.field_key === 'youtube_added')?.field_value).toBe(
        'YouTube added as a required platform this cycle',
      )
      const rules = await adapter.listCampaignRules(INFLOW_CAMPAIGN_ID)
      expect(rules.some((r) => r.body === 'Every video also carries #ad.')).toBe(true)
    })
  })

  it('says plainly when a re-parsed document adds nothing new', async () => {
    const user = userEvent.setup()
    await renderScreen()

    await user.click(screen.getByLabelText('Parsed JSON'))
    await user.paste(pasteResult())
    await user.click(screen.getByRole('button', { name: 'Compare with what is saved' }))

    expect(await screen.findByText(/nothing new/i)).toBeInTheDocument()
  })

  it('never creates a second campaign', async () => {
    const user = userEvent.setup()
    await renderScreen()

    await user.click(screen.getByLabelText('Parsed JSON'))
    await user.paste(pasteResult({ rules: ['A new rule from the update.'] }))
    await user.click(screen.getByRole('button', { name: 'Compare with what is saved' }))
    await screen.findByText(/new rules/i)
    await user.click(screen.getByRole('button', { name: 'Apply update' }))

    await waitFor(async () => {
      const campaigns = await adapter.listCampaigns()
      expect(campaigns.filter((c) => c.name === 'Inflow')).toHaveLength(1)
    })
  })
})
