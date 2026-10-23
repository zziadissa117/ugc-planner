// A login box writes only a real change. Tapping in and out used to save
// the row as it was - and, as the box keeps what it showed when drawn, wrote
// an old handle back over one changed on the phone since.

import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import type { DataAdapter } from '../data'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { AccountsEditor } from './AccountsEditor'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: DataAdapter
let campaignId: string

beforeEach(async () => {
  localStorage.clear()
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`accounts-blur-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
  const campaign = await adapter.createCampaign({
    name: 'Vertus', company: null, default_setup: 'face', approval_mode: 'none', pay_per_video_cents: 2000, cycle_size: null,
  })
  campaignId = campaign.id
})

describe('leaving a login box', () => {
  it('writes nothing when nothing changed, and the change when there is one', async () => {
    const user = userEvent.setup()
    const account = await adapter.addCampaignAccount({ campaign_id: campaignId, platform: 'TikTok', handle: '@old' })
    render(<AccountsEditor data={adapter} campaignId={campaignId} />)
    const box = await screen.findByRole('textbox', { name: 'TikTok handle' })

    await user.click(box)
    await user.tab()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const [untouched] = await adapter.listCampaignAccounts(campaignId)
    expect(untouched.updated_at).toBe(account.updated_at)

    await user.click(box)
    await user.clear(box)
    await user.type(box, '@new')
    await user.tab()
    await waitFor(async () => {
      const [changed] = await adapter.listCampaignAccounts(campaignId)
      expect(changed.handle).toBe('@new')
    })
  })
})
