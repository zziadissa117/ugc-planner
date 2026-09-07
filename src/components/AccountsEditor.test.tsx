// A real ten-campaign dogfooding pass found this the hard way: nothing here
// stopped "Instagram & Youtube" being saved as a single account with no
// handle, because Platform is deliberately free text - a new platform must
// never need a migration. That left a real campaign with one malformed
// account instead of two real ones, each demanding a handle the app then had
// nowhere to render.

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
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`accounts-${crypto.randomUUID()}`)
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

function renderEditor() {
  render(<AccountsEditor data={adapter} campaignId={campaignId} />)
}

describe('adding an account', () => {
  it('refuses a platform that is really two platforms typed together', async () => {
    const user = userEvent.setup()
    renderEditor()

    for (const combined of ['Instagram & Youtube', 'TikTok, Instagram', 'IG/TikTok', 'TikTok and Instagram']) {
      await user.clear(screen.getByLabelText('Platform'))
      await user.type(screen.getByLabelText('Platform'), combined)
      await user.click(screen.getByRole('button', { name: 'Add account' }))
      expect(await screen.findByText(/more than one platform/i)).toBeInTheDocument()
    }

    // None of the rejected attempts ever reached the store.
    expect(await adapter.listCampaignAccounts(campaignId)).toHaveLength(0)
  })

  it('saves two separate platforms as two separate accounts', async () => {
    const user = userEvent.setup()
    renderEditor()

    await user.type(screen.getByLabelText('Platform'), 'Instagram')
    await user.type(screen.getByLabelText('Handle'), '@vertus.ig')
    await user.click(screen.getByRole('button', { name: 'Add account' }))
    // "Instagram" also names a quick-pick button that exists from the start,
    // so waiting for that text is not proof the add landed - wait on the
    // store itself instead, or the second add below can race the first
    // account's own field reset and get its typed text wiped out under it.
    await waitFor(async () => {
      expect(await adapter.listCampaignAccounts(campaignId)).toHaveLength(1)
    })

    await user.type(screen.getByLabelText('Platform'), 'YouTube')
    await user.type(screen.getByLabelText('Handle'), '@vertus.yt')
    await user.click(screen.getByRole('button', { name: 'Add account' }))
    await waitFor(async () => {
      expect(await adapter.listCampaignAccounts(campaignId)).toHaveLength(2)
    })

    const accounts = await adapter.listCampaignAccounts(campaignId)
    expect(accounts.map((a) => a.platform).sort()).toEqual(['Instagram', 'YouTube'])
    expect(accounts.every((a) => a.handle !== null)).toBe(true)
  })

  it('still allows a platform name that only happens to contain "and"-like text, case aside', async () => {
    // The guard is deliberately about separators, not about being clever - a
    // real platform name should never collide with it in practice, but the
    // word-boundary match on "and" must not fire on part of a longer word.
    const user = userEvent.setup()
    renderEditor()

    await user.type(screen.getByLabelText('Platform'), 'Bandcamp')
    await user.click(screen.getByRole('button', { name: 'Add account' }))

    await waitFor(async () => {
      expect(await adapter.listCampaignAccounts(campaignId)).toHaveLength(1)
    })
    expect(screen.queryByText(/more than one platform/i)).toBeNull()
  })

  it('warns when every saved account has no handle', async () => {
    const user = userEvent.setup()
    renderEditor()

    await user.type(screen.getByLabelText('Platform'), 'Instagram')
    await user.click(screen.getByRole('button', { name: 'Add account' }))

    expect(await screen.findByText(/no @ handle saved on any account/i)).toBeInTheDocument()
  })
})
