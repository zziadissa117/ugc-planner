// The creative brief and his own hook ideas, now in the FILM console rather
// than on the campaign page: "if there's a brief, then that's where hooks are
// going to get generated".

import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import type { CampaignField, DataAdapter } from '../data'
import { DataContext } from '../data/context'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { CreativeBrief } from './CreativeBrief'

const USER = '11111111-1111-4111-8111-111111111111'

let adapter: DataAdapter
let campaignId: string

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`creative-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
  const campaign = await adapter.createCampaign({
    name: 'Vertus',
    company: null,
    default_setup: 'face',
    approval_mode: 'none',
    pay_per_video_cents: 2000,
    cycle_size: null,
  })
  campaignId = campaign.id
})

function renderBrief(field?: CampaignField) {
  render(
    <DataContext.Provider value={adapter}>
      <CreativeBrief campaignId={campaignId} field={field} onChanged={() => undefined} />
    </DataContext.Provider>,
  )
}

describe('the creative brief', () => {
  it('is folded, and says when there is none', () => {
    renderBrief()
    const summary = screen.getByText('Creative brief')
    expect(summary.closest('details')).not.toHaveAttribute('open')
    expect(screen.getByText('none')).toBeInTheDocument()
    expect(screen.getByText(/No creative brief/)).toBeInTheDocument()
  })

  it('takes a whole pasted document and keeps it in one piece', async () => {
    const doc = ['# Vertus Campaign Brief', '', '## PRODUCT', 'Vertus - an AI system at waitlist stage.', '', '## VOICE', 'Overheard, not pitched.'].join('\n')
    const user = userEvent.setup()
    renderBrief()

    await user.click(screen.getByLabelText('Brief for the hook writer'))
    await user.paste(doc)
    await user.click(screen.getByRole('button', { name: 'Save the brief' }))

    await waitFor(async () => {
      const fields = await adapter.listCampaignFields(campaignId)
      expect(fields.find((f) => f.field_key === 'generation_brief')?.field_value).toBe(doc)
    })
    // One field, not a pile of hooks.
    expect(await adapter.listCampaignHooks(campaignId)).toHaveLength(0)
  })

  it('says when Claude wrote it and it has not been checked', () => {
    renderBrief({
      id: 'f',
      user_id: USER,
      campaign_id: 'x',
      field_key: 'generation_brief',
      field_value: '## PRODUCT\nA thing.',
      source: 'parsed_unreviewed',
      source_quote: null,
      source_document_id: null,
      confirmed_at: null,
      updated_at: new Date().toISOString(),
    })
    expect(screen.getByText('written by Claude, not checked')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Looks right - save it' })).toBeInTheDocument()
  })
})

describe('his own hooks and ideas', () => {
  it('takes a dump of several ideas at once, split on blank lines, as his words', async () => {
    const user = userEvent.setup()
    renderBrief()

    await user.type(
      screen.getByLabelText('Hooks and ideas'),
      'POV: your payout is frozen{enter}{enter}Format: screen recording, then talk over it',
    )
    await user.click(screen.getByRole('button', { name: 'Save these ideas' }))

    await waitFor(async () => {
      const hooks = await adapter.listCampaignHooks(campaignId)
      expect(hooks.map((h) => h.body)).toEqual(['POV: your payout is frozen', 'Format: screen recording, then talk over it'])
      expect(hooks.every((h) => h.source === 'user_entered' && h.model === null)).toBe(true)
    })
  })

  it('deletes one without touching the others', async () => {
    for (const body of ['Keep this one', 'Delete this one']) {
      await adapter.addCampaignHook({
        campaign_id: campaignId,
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
    renderBrief()

    await user.click(await screen.findByRole('button', { name: /Delete hook: Delete this one/ }))
    await waitFor(async () => {
      expect((await adapter.listCampaignHooks(campaignId)).map((h) => h.body)).toEqual(['Keep this one'])
    })
  })
})
