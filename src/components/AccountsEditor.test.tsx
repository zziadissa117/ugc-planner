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
  localStorage.clear()
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

    await user.click(screen.getByRole('button', { name: 'Different login per account' }))
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

  it('shows the whole handle and email at rest, in boxes that wrap rather than clip', async () => {
    // "i can only see the full username when i click on it." A one-line input
    // cuts a long value off at its edge; these are wrapping boxes instead.
    const account = await adapter.addCampaignAccount({
      campaign_id: campaignId,
      platform: 'Instagram',
      handle: '@a.very.long.handle.that.would.not.fit.on.one.line',
      email: 'someone.with.a.long.address@a-long-domain-name.example.com',
    })
    renderEditor()

    // One account, so one login: it shows once, above the platforms.
    const handle = await screen.findByLabelText('Instagram handle')
    const email = screen.getByLabelText('Email for all accounts')
    expect(handle.tagName).toBe('TEXTAREA')
    expect(email.tagName).toBe('TEXTAREA')
    expect(handle).toHaveValue(account.handle)
    expect(email).toHaveValue(account.email)
  })

  it('saves on Enter instead of adding a line to a handle', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('button', { name: 'Instagram' }))
    await waitFor(async () => {
      expect(await adapter.listCampaignAccounts(campaignId)).toHaveLength(1)
    })

    await user.type(screen.getByLabelText('Instagram handle'), '@one.line{Enter}')

    await waitFor(async () => {
      const [account] = await adapter.listCampaignAccounts(campaignId)
      expect(account.handle).toBe('@one.line')
    })
  })

  it('hides the password until Show is tapped', async () => {
    const user = userEvent.setup()
    renderEditor()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('button', { name: 'TikTok' }))

    const password = await screen.findByLabelText('Password for all accounts')
    expect(password).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: 'Show' }))
    expect(screen.getByLabelText('Password for all accounts')).toHaveAttribute('type', 'text')
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

describe('one login for every account, or one each', () => {
  async function twoAccounts(a: { email: string | null; password: string | null }, b: { email: string | null; password: string | null }) {
    await adapter.addCampaignAccount({ campaign_id: campaignId, platform: 'TikTok', handle: '@tt', ...a })
    await adapter.addCampaignAccount({ campaign_id: campaignId, platform: 'Instagram', handle: '@ig', ...b, sort_order: 1 })
  }

  it('starts on "same for all" when every account shares one login, and writes it to all of them', async () => {
    await twoAccounts({ email: 'one@example.com', password: 'pw' }, { email: 'one@example.com', password: 'pw' })
    const user = userEvent.setup()
    renderEditor()

    const email = await screen.findByLabelText('Email for all accounts')
    expect(screen.getByRole('button', { name: 'Same login for all accounts' })).toHaveAttribute('aria-pressed', 'true')
    // Each platform shows only its username.
    expect(screen.queryByLabelText('TikTok email')).toBeNull()

    await user.clear(email)
    await user.type(email, 'new@example.com')
    await user.tab()

    await waitFor(async () => {
      const accounts = await adapter.listCampaignAccounts(campaignId)
      expect(accounts.map((a) => a.email)).toEqual(['new@example.com', 'new@example.com'])
    })
  })

  it('starts on "different" when the accounts have their own logins', async () => {
    await twoAccounts({ email: 'tt@example.com', password: 'a' }, { email: 'ig@example.com', password: 'b' })
    renderEditor()

    expect(await screen.findByLabelText('TikTok email')).toHaveValue('tt@example.com')
    expect(screen.getByLabelText('Instagram email')).toHaveValue('ig@example.com')
    expect(screen.getByRole('button', { name: 'Different login per account' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('asks before one login overwrites different ones, and leaves them alone when told to', async () => {
    await twoAccounts({ email: 'tt@example.com', password: 'a' }, { email: 'ig@example.com', password: 'b' })
    const user = userEvent.setup()
    renderEditor()
    await screen.findByLabelText('TikTok email')

    await user.click(screen.getByRole('button', { name: 'Same login for all accounts' }))
    await user.click(screen.getByRole('button', { name: 'Keep them different' }))
    expect((await adapter.listCampaignAccounts(campaignId)).map((a) => a.email)).toEqual(['tt@example.com', 'ig@example.com'])

    await user.click(screen.getByRole('button', { name: 'Same login for all accounts' }))
    await user.click(screen.getByRole('button', { name: 'Use it for all' }))
    await waitFor(async () => {
      const accounts = await adapter.listCampaignAccounts(campaignId)
      expect(accounts.map((a) => [a.email, a.password])).toEqual([
        ['tt@example.com', 'a'],
        ['tt@example.com', 'a'],
      ])
    })
  })

  it('gives a platform added later the shared login', async () => {
    await adapter.addCampaignAccount({ campaign_id: campaignId, platform: 'TikTok', handle: null, email: 'one@example.com', password: 'pw' })
    const user = userEvent.setup()
    renderEditor()
    await screen.findByLabelText('Email for all accounts')

    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('button', { name: 'YouTube' }))

    await waitFor(async () => {
      const youtube = (await adapter.listCampaignAccounts(campaignId)).find((a) => a.platform === 'YouTube')
      expect([youtube?.email, youtube?.password]).toEqual(['one@example.com', 'pw'])
    })
  })

  it('copies a login with one tap', async () => {
    await adapter.addCampaignAccount({ campaign_id: campaignId, platform: 'TikTok', handle: '@tt', email: 'one@example.com', password: 'pw' })
    // userEvent.setup() puts its own clipboard in place; read back from it.
    const user = userEvent.setup()
    renderEditor()

    await user.click(await screen.findByRole('button', { name: 'Copy email for all accounts' }))
    expect(await screen.findByText('Copied')).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe('one@example.com')
  })
})

describe('adding back a platform that was removed', () => {
  it('brings the same account back instead of refusing it', async () => {
    const first = await adapter.addCampaignAccount({ campaign_id: campaignId, platform: 'TikTok', handle: '@tt' })
    await adapter.deleteCampaignAccount(first.id)
    expect(await adapter.listCampaignAccounts(campaignId)).toHaveLength(0)

    const again = await adapter.addCampaignAccount({ campaign_id: campaignId, platform: 'TikTok', handle: null })
    expect(again.id).toBe(first.id)
    expect(again.is_active).toBe(true)
    expect(again.handle).toBe('@tt')
    expect(await adapter.listCampaignAccounts(campaignId)).toHaveLength(1)
  })

  it('still refuses a second live account on the same platform', async () => {
    await adapter.addCampaignAccount({ campaign_id: campaignId, platform: 'TikTok', handle: '@tt' })
    await expect(adapter.addCampaignAccount({ campaign_id: campaignId, platform: 'TikTok', handle: null })).rejects.toThrow(
      /already has a TikTok account/,
    )
  })
})
