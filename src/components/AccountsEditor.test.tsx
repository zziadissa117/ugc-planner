// Picking platforms, and the login that belongs to each one.
//
// A real ten-campaign pass found the reason this is a picker rather than a
// text box: a live campaign held one account called "Instagram & Youtube"
// with no handle - two platforms in one row, which the posting grid could
// only draw as a single line and no handle could describe. Picking from a
// list makes that shape unrepresentable.

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

describe('picking platforms', () => {
  it('keeps the add controls out of the way until asked for', async () => {
    const user = userEvent.setup()
    renderEditor()

    expect(screen.queryByRole('button', { name: 'Instagram' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByRole('button', { name: 'Instagram' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('button', { name: 'Instagram' })).toBeNull()
  })

  it('adds each platform as its own account', async () => {
    const user = userEvent.setup()
    renderEditor()

    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('button', { name: 'Instagram' }))
    await waitFor(async () => {
      expect(await adapter.listCampaignAccounts(campaignId)).toHaveLength(1)
    })

    await user.click(screen.getByRole('button', { name: 'YouTube' }))
    await waitFor(async () => {
      expect(await adapter.listCampaignAccounts(campaignId)).toHaveLength(2)
    })

    const accounts = await adapter.listCampaignAccounts(campaignId)
    expect(accounts.map((a) => a.platform).sort()).toEqual(['Instagram', 'YouTube'])
  })

  it('cannot produce one account holding two platforms', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('button', { name: 'Add' }))

    // The only free-text way in is the "other platform" box, and what it
    // makes is still a single row - there is no control that turns one entry
    // into "Instagram & Youtube" across two of them.
    await user.click(screen.getByRole('button', { name: 'Instagram' }))
    await waitFor(async () => {
      expect(await adapter.listCampaignAccounts(campaignId)).toHaveLength(1)
    })
    await user.click(screen.getByRole('button', { name: 'YouTube' }))
    await waitFor(async () => {
      expect(await adapter.listCampaignAccounts(campaignId)).toHaveLength(2)
    })

    const accounts = await adapter.listCampaignAccounts(campaignId)
    for (const account of accounts) {
      expect(account.platform).not.toMatch(/[,&/]| and /i)
    }
  })

  it('will not add the same platform twice', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('button', { name: 'Instagram' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Instagram ✓' })).toBeDisabled()
    })
    expect(await adapter.listCampaignAccounts(campaignId)).toHaveLength(1)
  })

  it('takes a platform that is not on the list, one at a time', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await user.type(screen.getByLabelText('Other platform'), 'Threads')
    // The header toggle reads "Done" while the panel is open, so this is the
    // add-a-custom-platform button and nothing else.
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(async () => {
      const accounts = await adapter.listCampaignAccounts(campaignId)
      expect(accounts.map((a) => a.platform)).toEqual(['Threads'])
    })
  })
})

describe('the login for each platform', () => {
  it('saves handle, email and password against that one account', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('button', { name: 'Instagram' }))
    await waitFor(async () => {
      expect(await adapter.listCampaignAccounts(campaignId)).toHaveLength(1)
    })

    await user.type(screen.getByLabelText('Instagram handle'), '@vertus.ig')
    await user.type(screen.getByLabelText('Instagram email'), 'ig@example.com')
    await user.type(screen.getByLabelText('Instagram password'), 'hunter2')
    await user.tab()

    await waitFor(async () => {
      const [account] = await adapter.listCampaignAccounts(campaignId)
      expect(account.handle).toBe('@vertus.ig')
      expect(account.email).toBe('ig@example.com')
      expect(account.password).toBe('hunter2')
    })
  })

  it('hides the password until Show is tapped', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('button', { name: 'TikTok' }))

    const password = await screen.findByLabelText('TikTok password')
    expect(password).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: 'Show' }))
    expect(screen.getByLabelText('TikTok password')).toHaveAttribute('type', 'text')
  })

  it('keeps two campaigns posting to the same platform on separate logins', async () => {
    // One creator, several accounts per platform: the login belongs to the
    // account, never to the platform and never to the creator.
    const other = await adapter.createCampaign({
      name: 'Inflow',
      company: null,
      default_setup: 'face',
      approval_mode: 'none',
      pay_per_video_cents: 3500,
      cycle_size: null,
    })
    await adapter.addCampaignAccount({
      campaign_id: other.id,
      platform: 'Instagram',
      handle: '@michael.financier',
      email: 'inflow@example.com',
      password: 'one',
    })
    await adapter.addCampaignAccount({
      campaign_id: campaignId,
      platform: 'Instagram',
      handle: '@vertus.ig',
      email: 'vertus@example.com',
      password: 'two',
    })

    const mine = await adapter.listCampaignAccounts(campaignId)
    expect(mine).toHaveLength(1)
    expect(mine[0].email).toBe('vertus@example.com')
  })
})
