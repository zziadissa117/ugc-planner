// A new campaign, typed in on one page: no brief, no contract, no parse.
//
// Name, pay per video, how many videos (Unlimited / 1 a day / Limited - the
// choice only changes the question, posts_per_week is always a day x 7),
// whether there is a minimum number of views, the platforms, and the login
// for each account under a red warning. One Save writes it all together.

import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import type { DataAdapter } from '../data'
import { DataContext } from '../data/context'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { GENERATION_BRIEF_KEY } from '../hooks/generateHooks'
import { NewCampaign } from './NewCampaign'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: DataAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`new-campaign-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})

function renderForm() {
  render(
    <DataContext.Provider value={adapter}>
      <MemoryRouter initialEntries={['/campaigns/new']}>
        <Routes>
          <Route path="/campaigns/new" element={<NewCampaign />} />
          <Route path="/campaigns/:campaignId" element={<p>campaign page</p>} />
        </Routes>
      </MemoryRouter>
    </DataContext.Provider>,
  )
}

type User = ReturnType<typeof userEvent.setup>

async function saved() {
  await screen.findByText('campaign page')
  const [campaign] = await adapter.listCampaigns()
  return campaign
}

describe('the page', () => {
  it('has no upload, no pasted JSON and no review step', () => {
    renderForm()

    expect(screen.getByRole('heading', { name: 'New campaign' })).toBeInTheDocument()
    for (const gone of [/brief/i, /contract/i, /parsed json/i, /review it/i, /type it in myself/i, /upload/i]) {
      expect(screen.queryByText(gone)).toBeNull()
      expect(screen.queryByRole('button', { name: gone })).toBeNull()
    }
  })

  it('asks the questions in plain words', () => {
    renderForm()

    expect(screen.getByLabelText('Campaign name')).toBeInTheDocument()
    expect(screen.getByLabelText('Pay per video')).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'How many videos?' })).toBeInTheDocument()
    for (const choice of ['Unlimited', '1 a day', 'Limited']) {
      expect(screen.getByRole('radio', { name: choice })).toBeInTheDocument()
    }
    expect(screen.getByRole('radiogroup', { name: 'Do you have to make high-quality videos?' })).toBeInTheDocument()
    expect(screen.getByText('Is there a minimum number of views?')).toBeInTheDocument()
    expect(screen.getByLabelText('Product & hook ideas')).toBeInTheDocument()
  })

  it('warns in red to add the accounts now, until one has a username', async () => {
    const user = userEvent.setup()
    renderForm()

    const warning = screen.getByRole('alert')
    expect(warning).toHaveTextContent("If you're going to run a campaign, add your accounts now. Don't wait.")
    expect(warning).toHaveClass('text-state-blocked')

    // A platform picked with nothing typed under it is not an account yet.
    await user.click(screen.getByRole('button', { name: 'TikTok' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()

    await user.type(screen.getByLabelText('TikTok handle'), '@me')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('will not save until it has a name and how many videos, and says what is missing', async () => {
    const user = userEvent.setup()
    renderForm()

    const save = screen.getByRole('button', { name: 'Save campaign' })
    expect(save).toBeDisabled()
    expect(screen.getByText('Still needed: the campaign name, how many videos.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Campaign name'), 'Vertus')
    await user.click(screen.getByRole('radio', { name: '1 a day' }))
    expect(save).not.toBeDisabled()
    expect(screen.queryByText(/Still needed/)).toBeNull()
  })
})

describe('how many videos', () => {
  async function fill(user: User, choice: string) {
    renderForm()
    await user.type(screen.getByLabelText('Campaign name'), 'Vertus')
    await user.click(screen.getByRole('radio', { name: choice }))
  }

  it('1 a day is seven a week, with nothing more to ask', async () => {
    const user = userEvent.setup()
    await fill(user, '1 a day')
    expect(screen.queryByLabelText(/How many a day/)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Save campaign' }))
    const campaign = await saved()
    expect(campaign.posts_per_week).toBe(7)
    expect(campaign.daily_post_quota).toBe(1)
  })

  it('Unlimited asks how many a day he will do, starting at 10', async () => {
    const user = userEvent.setup()
    await fill(user, 'Unlimited')

    const box = screen.getByLabelText('How many a day will you do?')
    expect(box).toHaveValue('10')

    await user.click(screen.getByRole('button', { name: 'Save campaign' }))
    const campaign = await saved()
    expect(campaign.posts_per_week).toBe(70)
    expect(campaign.daily_post_quota).toBe(10)
  })

  it('Unlimited takes his own number', async () => {
    const user = userEvent.setup()
    await fill(user, 'Unlimited')
    const box = screen.getByLabelText('How many a day will you do?')
    await user.clear(box)
    await user.type(box, '4')

    await user.click(screen.getByRole('button', { name: 'Save campaign' }))
    expect((await saved()).posts_per_week).toBe(28)
  })

  it('Limited asks how many a day, and starts empty - it is the deal\'s number', async () => {
    const user = userEvent.setup()
    await fill(user, 'Limited')

    const box = screen.getByLabelText('How many a day?')
    expect(box).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Save campaign' })).toBeDisabled()
    expect(screen.getByText('Still needed: how many a day.')).toBeInTheDocument()

    await user.type(box, '3')
    await user.click(screen.getByRole('button', { name: 'Save campaign' }))
    expect((await saved()).posts_per_week).toBe(21)
  })

  it('refuses zero or anything that is not a whole number', async () => {
    const user = userEvent.setup()
    await fill(user, 'Limited')

    for (const bad of ['0', '1.5', 'two']) {
      const box = screen.getByLabelText('How many a day?')
      await user.clear(box)
      await user.type(box, bad)
      expect(screen.getByRole('button', { name: 'Save campaign' })).toBeDisabled()
    }
  })
})

describe('pay per video', () => {
  it('is saved as integer cents', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByLabelText('Campaign name'), 'Vertus')
    await user.type(screen.getByLabelText('Pay per video'), '16.50')
    await user.click(screen.getByRole('radio', { name: '1 a day' }))
    await user.click(screen.getByRole('button', { name: 'Save campaign' }))

    expect((await saved()).pay_per_video_cents).toBe(1650)
  })

  it('can be left empty - "not saved yet", never a guess', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByLabelText('Campaign name'), 'Vertus')
    await user.click(screen.getByRole('radio', { name: '1 a day' }))
    await user.click(screen.getByRole('button', { name: 'Save campaign' }))

    expect((await saved()).pay_per_video_cents).toBeNull()
  })

  it('refuses something that is not an amount, and says so', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByLabelText('Campaign name'), 'Vertus')
    await user.click(screen.getByRole('radio', { name: '1 a day' }))
    await user.type(screen.getByLabelText('Pay per video'), 'lots')

    expect(screen.getByText('Enter an amount like 35 or 35.50.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save campaign' })).toBeDisabled()
  })
})

describe('high-quality videos', () => {
  async function start(user: User) {
    renderForm()
    await user.type(screen.getByLabelText('Campaign name'), 'Vertus')
    await user.click(screen.getByRole('radio', { name: '1 a day' }))
  }

  it('yes asks for the minimum views and saves it', async () => {
    const user = userEvent.setup()
    await start(user)
    expect(screen.queryByLabelText('Minimum views')).toBeNull()

    await user.click(screen.getByRole('radio', { name: 'Yes' }))
    expect(screen.getByRole('button', { name: 'Save campaign' })).toBeDisabled()
    await user.type(screen.getByLabelText('Minimum views'), '1.5k')
    await user.click(screen.getByRole('button', { name: 'Save campaign' }))

    expect((await saved()).min_views).toBe(1500)
  })

  it('no saves no minimum', async () => {
    const user = userEvent.setup()
    await start(user)
    await user.click(screen.getByRole('radio', { name: 'Yes' }))
    await user.type(screen.getByLabelText('Minimum views'), '1000')
    await user.click(screen.getByRole('radio', { name: 'No' }))
    expect(screen.queryByLabelText('Minimum views')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Save campaign' }))
    expect((await saved()).min_views).toBeNull()
  })
})

describe('accounts', () => {
  it('saves one account per platform, each with its own login, ready to post from', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByLabelText('Campaign name'), 'Vertus')
    await user.click(screen.getByRole('radio', { name: '1 a day' }))

    await user.click(screen.getByRole('button', { name: 'TikTok' }))
    await user.click(screen.getByRole('button', { name: 'Instagram' }))
    await user.type(screen.getByLabelText('TikTok handle'), '@vertus.tt')
    await user.type(screen.getByLabelText('TikTok email'), 'tt@example.com')
    await user.type(screen.getByLabelText('TikTok password'), 'hunter2')
    await user.type(screen.getByLabelText('Instagram handle'), '@vertus.ig')

    await user.click(screen.getByRole('button', { name: 'Save campaign' }))
    const campaign = await saved()
    const accounts = await adapter.listCampaignAccounts(campaign.id)

    expect(accounts.map((a) => [a.platform, a.handle, a.email, a.password])).toEqual([
      ['TikTok', '@vertus.tt', 'tt@example.com', 'hunter2'],
      ['Instagram', '@vertus.ig', null, null],
    ])
    // Ready from the start: no warm-up before he can post from it.
    expect(accounts.every((a) => a.status === 'ready')).toBe(true)
  })

  it('drops a platform he unpicks', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByLabelText('Campaign name'), 'Vertus')
    await user.click(screen.getByRole('radio', { name: '1 a day' }))
    await user.click(screen.getByRole('button', { name: 'YouTube' }))
    await user.type(screen.getByLabelText('YouTube handle'), '@gone')
    await user.click(screen.getByRole('button', { name: 'YouTube' }))
    expect(screen.queryByLabelText('YouTube handle')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Save campaign' }))
    expect(await adapter.listCampaignAccounts((await saved()).id)).toHaveLength(0)
  })

  it('still saves a campaign with no accounts - the warning is a push, not a gate', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByLabelText('Campaign name'), 'Vertus')
    await user.click(screen.getByRole('radio', { name: '1 a day' }))
    await user.click(screen.getByRole('button', { name: 'Save campaign' }))

    expect((await saved()).name).toBe('Vertus')
  })

  it('offers only the platforms the app knows - no free text that could hold two', () => {
    renderForm()
    const group = screen.getByRole('group', { name: 'Platforms' })
    expect(group.querySelector('input')).toBeNull()
  })
})

describe('product & hook ideas', () => {
  it('saves what he typed as his, word for word, for the hook writer', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByLabelText('Campaign name'), 'Vertus')
    await user.click(screen.getByRole('radio', { name: '1 a day' }))
    await user.type(screen.getByLabelText('Product & hook ideas'), 'A budgeting app.{Enter}Hook: I stopped checking my bank.')
    await user.click(screen.getByRole('button', { name: 'Save campaign' }))

    const fields = await adapter.listCampaignFields((await saved()).id)
    const ideas = fields.find((f) => f.field_key === GENERATION_BRIEF_KEY)
    expect(ideas?.field_value).toBe('A budgeting app.\nHook: I stopped checking my bank.')
    expect(ideas?.source).toBe('user_entered')
  })

  it('writes nothing when left empty', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByLabelText('Campaign name'), 'Vertus')
    await user.click(screen.getByRole('radio', { name: '1 a day' }))
    await user.click(screen.getByRole('button', { name: 'Save campaign' }))

    expect(await adapter.listCampaignFields((await saved()).id)).toEqual([])
  })
})

describe('saving', () => {
  it('lands every write locally and queues it for the server', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByLabelText('Campaign name'), 'Vertus')
    await user.click(screen.getByRole('radio', { name: '1 a day' }))
    await user.click(screen.getByRole('button', { name: 'TikTok' }))
    await user.type(screen.getByLabelText('TikTok handle'), '@me')
    await user.click(screen.getByRole('button', { name: 'Save campaign' }))
    await saved()

    await waitFor(async () => {
      const queued = (await adapter.listPendingWrites(100)).map((w) => w.table_name)
      expect(queued).toContain('campaigns')
      expect(queued).toContain('campaign_accounts')
    })
  })
})
