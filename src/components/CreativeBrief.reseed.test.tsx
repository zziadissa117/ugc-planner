// The brief box shows the brief that is saved, even when that brief arrives
// after the box was first drawn - and its Save button then saves THAT, not
// the blank the box held a moment earlier.

import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import type { CampaignField, DataAdapter } from '../data'
import { DataContext } from '../data/context'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { GENERATION_BRIEF_KEY } from '../hooks/generateHooks'
import { CreativeBrief } from './CreativeBrief'

const USER = '11111111-1111-4111-8111-111111111111'

let adapter: DataAdapter
let campaignId: string

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`creative-reseed-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
  const campaign = await adapter.createCampaign({
    name: 'Vertus', company: null, default_setup: 'face', approval_mode: 'none', pay_per_video_cents: 2000, cycle_size: null,
  })
  campaignId = campaign.id
})

function tree(field?: CampaignField) {
  return (
    <DataContext.Provider value={adapter}>
      <CreativeBrief campaignId={campaignId} field={field} onChanged={() => undefined} />
    </DataContext.Provider>
  )
}

describe('a brief that loads after the first paint', () => {
  it('fills the box, and saving keeps the brief instead of deleting it', async () => {
    const user = userEvent.setup()
    const field = await adapter.setCampaignField({
      campaign_id: campaignId, field_key: GENERATION_BRIEF_KEY, field_value: 'PRODUCT: Vertus. AUDIENCE: traders.',
      source: 'parsed_unreviewed', source_quote: null, source_document_id: null,
    })

    // Drawn before the fields loaded...
    const { rerender } = render(tree(undefined))
    await user.click(screen.getByText('Creative brief'))
    expect(screen.getByRole('textbox', { name: 'Brief for the hook writer' })).toHaveValue('')

    // ...then the saved brief lands.
    rerender(tree(field))
    expect(screen.getByRole('textbox', { name: 'Brief for the hook writer' })).toHaveValue('PRODUCT: Vertus. AUDIENCE: traders.')

    await user.click(screen.getByRole('button', { name: 'Looks right - save it' }))
    await waitFor(async () => {
      const saved = (await adapter.listCampaignFields(campaignId)).find((f) => f.field_key === GENERATION_BRIEF_KEY)
      expect(saved?.field_value).toBe('PRODUCT: Vertus. AUDIENCE: traders.')
      expect(saved?.source).toBe('user_entered')
    })
  })
})
