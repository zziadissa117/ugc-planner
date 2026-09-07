import 'fake-indexeddb/auto'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DataAdapter } from '../data'
import { DataContext } from '../data/context'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { NewCampaign } from './NewCampaign'

// EdgeFunctionParser reaches getSupabaseClient() from src/sync/auth - mocked
// so tests control "the server call succeeded" directly instead of needing a
// real network. See src/parser/parser.test.ts for the same pattern.
const invoke = vi.fn()
let mockClient: { functions: { invoke: typeof invoke } } | null = null
vi.mock('../sync/auth', () => ({
  getSupabaseClient: () => mockClient,
}))

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: DataAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`drop-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()

  // Deterministic regardless of what's in .env (a real deployed function
  // flips this to true) - most tests below exercise the paste-JSON fallback
  // path specifically, and the availability-message tests override this
  // themselves per case.
  vi.stubEnv('VITE_PARSE_CAMPAIGN_DEPLOYED', 'false')
  mockClient = null
  invoke.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const CONTRACT = 'Per-post compensation: $35.00 per approved deliverable.'

function renderDropBox() {
  render(
    <DataContext.Provider value={adapter}>
      <MemoryRouter>
        <NewCampaign />
      </MemoryRouter>
    </DataContext.Provider>,
  )
}

/** Types into a textarea without userEvent's per-character cost. */
async function paste(user: ReturnType<typeof userEvent.setup>, label: string, text: string) {
  const field = screen.getByLabelText(label)
  await user.click(field)
  await user.paste(text)
}

const goodJson = JSON.stringify({
  campaign: { name: 'Inflow', company: 'Inflowpay', approval_mode: 'video' },
  fields: {
    pay_per_video_cents: {
      value: '3500',
      source_quote: '$35.00 per approved deliverable',
      from: 'contract',
    },
    submission_url: { value: null, source_quote: null },
  },
})

describe('typing a campaign in by hand', () => {
  // No brief, no contract, no parse. He knows what his campaigns pay and
  // where they post; requiring a document before he could say so meant the
  // rate could only ever arrive through a parser that found one.
  async function reachManual(user: ReturnType<typeof userEvent.setup>) {
    renderDropBox()
    await user.click(screen.getByRole('button', { name: 'Type it in myself' }))
  }

  it('is offered without a document of any kind', async () => {
    renderDropBox()
    expect(screen.getByRole('button', { name: 'Type it in myself' })).not.toBeDisabled()
  })

  it('saves a name, a rate, a daily quota and a platform', async () => {
    const user = userEvent.setup()
    await reachManual(user)

    await user.type(screen.getByLabelText('Campaign name'), 'Vertus')
    await user.type(screen.getByLabelText('Dollars per post'), '50')
    const quota = screen.getByLabelText('Posts owed per day')
    await user.clear(quota)
    await user.type(quota, '4')
    await user.click(screen.getByRole('button', { name: 'TikTok' }))
    await user.type(screen.getByLabelText('TikTok handle'), '@vertus.creator')

    await user.click(screen.getByRole('button', { name: 'Save campaign' }))

    // On the rate, not on the row: the campaign lands first and the rate is
    // written a moment later, so waiting for the row races the field write.
    await waitFor(async () => {
      const [row] = await adapter.listCampaigns()
      expect(row?.pay_per_video_cents).toBe(5000)
    })
    const [saved] = await adapter.listCampaigns()
    expect(saved.name).toBe('Vertus')
    expect(saved.daily_post_quota).toBe(4)

    // His word for the rate, not a document's.
    const fields = await adapter.listCampaignFields(saved.id)
    expect(fields.find((f) => f.field_key === 'pay_per_video_cents')?.source).toBe('user_entered')

    await waitFor(async () => {
      expect(await adapter.listCampaignAccounts(saved.id)).toHaveLength(1)
    })
    const accounts = await adapter.listCampaignAccounts(saved.id)
    expect(accounts[0].platform).toBe('TikTok')
    expect(accounts[0].handle).toBe('@vertus.creator')
  })

  it('needs only a name - everything else can wait for the brief page', async () => {
    const user = userEvent.setup()
    await reachManual(user)

    expect(screen.getByRole('button', { name: 'Save campaign' })).toBeDisabled()
    await user.type(screen.getByLabelText('Campaign name'), 'Nameless no more')
    await user.click(screen.getByRole('button', { name: 'Save campaign' }))

    await waitFor(async () => {
      expect(await adapter.listCampaigns()).toHaveLength(1)
    })
    const [saved] = await adapter.listCampaigns()
    expect(saved.pay_per_video_cents).toBeNull()
  })
})

describe('the drop box', () => {
  it('offers both document slots with tap-to-pick and a paste area', async () => {
    renderDropBox()

    // Phones do not really drag and drop, so the file button is a real target
    // rather than a drop zone with a hidden input.
    expect(screen.getByLabelText('BRIEF (.md) file')).toBeInTheDocument()
    expect(screen.getByLabelText('CONTRACT (.md) file')).toBeInTheDocument()
    expect(screen.getByLabelText('BRIEF (.md) text')).toBeInTheDocument()
    expect(screen.getByLabelText('CONTRACT (.md) text')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Choose a file' })).toHaveLength(2)
  })

  describe('the server parser availability message', () => {
    it('says it is not deployed and what to do instead, when the flag is off', async () => {
      renderDropBox()
      expect(screen.getByText(/server parser is not deployed yet/i)).toBeInTheDocument()
      expect(screen.getByLabelText('Parsed JSON')).toBeInTheDocument()
    })

    it('offers to read the documents itself once the deploy flag is on, but keeps the paste box for offline', async () => {
      vi.stubEnv('VITE_PARSE_CAMPAIGN_DEPLOYED', 'true')
      mockClient = { functions: { invoke } }
      renderDropBox()
      expect(screen.getByText(/the server reads the documents/i)).toBeInTheDocument()
      // isAvailable() means "configured", not "there is a connection right
      // now" - the offline fallback has to stay reachable, not hidden behind
      // a flag that says nothing about actual connectivity.
      expect(screen.getByLabelText('Parsed JSON')).toBeInTheDocument()
    })

    it('actually calls the server parser when available, rather than just saying it will', async () => {
      vi.stubEnv('VITE_PARSE_CAMPAIGN_DEPLOYED', 'true')
      mockClient = { functions: { invoke } }
      invoke.mockResolvedValue({
        data: {
          campaign: { name: 'Server-parsed campaign', company: null, approval_mode: null },
          fields: {},
          bonus_tiers: [],
          rules: [],
          brief_is_incomplete: false,
          warnings: [],
        },
        error: null,
      })

      const user = userEvent.setup()
      renderDropBox()
      await paste(user, 'CONTRACT (.md) text', CONTRACT)
      await user.click(screen.getByRole('button', { name: 'Review it' }))

      await screen.findByRole('heading', { name: 'Review' })
      expect(screen.getByText('Server-parsed campaign')).toBeInTheDocument()
      expect(invoke).toHaveBeenCalledWith('parse-campaign', {
        body: { briefText: null, contractText: CONTRACT },
      })
    })

    it('uses pasted JSON instead of the server when both are present - the offline path', async () => {
      vi.stubEnv('VITE_PARSE_CAMPAIGN_DEPLOYED', 'true')
      mockClient = { functions: { invoke } }
      invoke.mockRejectedValue(new Error('should never be called'))

      const user = userEvent.setup()
      renderDropBox()
      await paste(user, 'CONTRACT (.md) text', CONTRACT)
      await paste(user, 'Parsed JSON', goodJson)
      await user.click(screen.getByRole('button', { name: 'Review it' }))

      await screen.findByRole('heading', { name: 'Review' })
      expect(invoke).not.toHaveBeenCalled()
    })
  })

  it('reports bad JSON without crashing', async () => {
    const user = userEvent.setup()
    renderDropBox()

    await paste(user, 'Parsed JSON', 'definitely not json')
    await user.click(screen.getByRole('button', { name: 'Review it' }))

    expect(await screen.findByText(/that is not valid json/i)).toBeInTheDocument()
  })
})

describe('the review screen', () => {
  async function reachReview(user: ReturnType<typeof userEvent.setup>, json = goodJson) {
    renderDropBox()
    await paste(user, 'CONTRACT (.md) text', CONTRACT)
    await paste(user, 'Parsed JSON', json)
    await user.click(screen.getByRole('button', { name: 'Review it' }))
    await screen.findByRole('heading', { name: 'Review' })
  }

  it('shows the contract rate in dollars, and does not rewrite it as his own', async () => {
    const user = userEvent.setup()
    await reachReview(user)

    expect(screen.getByLabelText('Dollars per post')).toHaveValue('35.00')

    // Confirm the parsed row, leave the box alone, save.
    const list = screen.getByRole('list', { name: 'Parsed fields' })
    await user.click(within(list).getByRole('button'))
    await user.click(screen.getByRole('button', { name: 'Save campaign' }))

    await waitFor(async () => {
      const [saved] = await adapter.listCampaigns()
      expect(saved?.pay_per_video_cents).toBe(3500)
    })
    const [saved] = await adapter.listCampaigns()
    const fields = await adapter.listCampaignFields(saved.id)
    // Still the contract's word for it, with the quote behind it - not his.
    const field = fields.find((f) => f.field_key === 'pay_per_video_cents')
    expect(field?.source).toBe('documented')
    expect(field?.source_quote).toBe('$35.00 per approved deliverable')
  })

  it('takes a correction to a rate the contract stated', async () => {
    const user = userEvent.setup()
    await reachReview(user)

    const rate = screen.getByLabelText('Dollars per post')
    await user.clear(rate)
    await user.type(rate, '40')
    await user.click(screen.getByRole('button', { name: 'Save campaign' }))

    await waitFor(async () => {
      const [saved] = await adapter.listCampaigns()
      expect(saved?.pay_per_video_cents).toBe(4000)
    })
    const [saved] = await adapter.listCampaigns()
    const fields = await adapter.listCampaignFields(saved.id)
    expect(fields.find((f) => f.field_key === 'pay_per_video_cents')?.source).toBe('user_entered')
  })

  it('renders a parsed field amber and unreviewed until it is tapped', async () => {
    const user = userEvent.setup()
    await reachReview(user)

    const list = screen.getByRole('list', { name: 'Parsed fields' })
    const row = within(list).getByRole('button')

    expect(row).toHaveAttribute('aria-pressed', 'false')
    expect(within(row).getByText('from file - unreviewed')).toBeInTheDocument()
    // The quote it came from is shown, so confirming means checking.
    expect(within(row).getByText(/\$35\.00 per approved deliverable/)).toBeInTheDocument()

    await user.click(row)
    expect(row).toHaveAttribute('aria-pressed', 'true')
    expect(within(row).getByText('confirmed')).toBeInTheDocument()
  })

  it('lists a field the parser did not find as not saved yet', async () => {
    const user = userEvent.setup()
    await reachReview(user)

    const blanks = screen.getByRole('list', { name: 'Blank fields' })
    expect(within(blanks).getByText('submission url')).toBeInTheDocument()
    expect(within(blanks).getByText('not saved yet')).toBeInTheDocument()
  })

  it('drops a field whose quote is not in the document, and says so', async () => {
    const user = userEvent.setup()
    await reachReview(
      user,
      JSON.stringify({
        campaign: { name: 'Inflow' },
        fields: {
          cycle_size: {
            // Nowhere in the contract above.
            value: '60',
            source_quote: 'A payment cycle completes when 60 deliverables',
            from: 'contract',
          },
        },
      }),
    )

    const blanks = screen.getByRole('list', { name: 'Blank fields' })
    expect(within(blanks).getByText('cycle size')).toBeInTheDocument()
    expect(within(blanks).getByText('quote not in the document')).toBeInTheDocument()
    expect(screen.getByText(/1 field was dropped/i)).toBeInTheDocument()
    // And it is not offered for confirmation.
    expect(screen.queryByRole('list', { name: 'Parsed fields' })).toBeNull()
  })

  it('says in one plain line what no document ever contains', async () => {
    const user = userEvent.setup()
    await reachReview(user)
    expect(screen.getByText(/nothing was guessed for them/i)).toBeInTheDocument()
  })

  it('warns when the brief looks incomplete', async () => {
    const user = userEvent.setup()
    renderDropBox()

    await paste(user, 'BRIEF (.md) text', '## 1. Product\ntext\n## 4. Rules\ntext')
    await paste(user, 'Parsed JSON', JSON.stringify({ campaign: { name: 'Inflow' } }))
    await user.click(screen.getByRole('button', { name: 'Review it' }))

    await screen.findByRole('heading', { name: 'Review' })
    expect(screen.getByText(/this brief looks incomplete/i)).toBeInTheDocument()
  })

  it('saves the campaign with confirmed fields documented and the rest amber', async () => {
    const user = userEvent.setup()
    await reachReview(user)

    await user.click(within(screen.getByRole('list', { name: 'Parsed fields' })).getByRole('button'))
    await user.click(screen.getByRole('button', { name: 'Save campaign' }))

    // The campaign row appears before its fields do, so waiting on the row
    // alone would read a half-written campaign. Wait for the last thing the
    // save does instead: promoting the confirmed field.
    await waitFor(async () => {
      const [saved] = await adapter.listCampaigns()
      expect(saved).toBeDefined()
      const written = await adapter.listCampaignFields(saved.id)
      expect(written.find((f) => f.field_key === 'pay_per_video_cents')?.source).toBe('documented')
    })

    const [campaign] = await adapter.listCampaigns()
    expect(campaign.name).toBe('Inflow')
    expect(campaign.pay_per_video_cents).toBe(3500)

    const fields = await adapter.listCampaignFields(campaign.id)
    expect(fields.find((f) => f.field_key === 'submission_url')?.source).toBe('missing')

    // The raw contract text is kept, so the quote can be checked again later.
    const documents = await adapter.listCampaignDocuments(campaign.id)
    expect(documents.find((d) => d.kind === 'contract')?.raw_text).toBe(CONTRACT)
  })
})

describe('where the campaign posts', () => {
  async function reachReview(user: ReturnType<typeof userEvent.setup>) {
    renderDropBox()
    await paste(user, 'Parsed JSON', JSON.stringify({ campaign: { name: 'Fresh campaign' } }))
    await user.click(screen.getByRole('button', { name: 'Review it' }))
    await screen.findByRole('heading', { name: 'Review' })
  }

  it('saves without a platform rather than refusing at the last step', async () => {
    // The old screen would not save a campaign with no @ on it. Being blocked
    // at the end of a long parse is worse than a campaign he finishes on the
    // brief page a minute later.
    const user = userEvent.setup()
    await reachReview(user)

    expect(screen.getByRole('button', { name: 'Save campaign' })).not.toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Save campaign' }))

    await waitFor(async () => {
      expect(await adapter.listCampaigns()).toHaveLength(1)
    })
  })

  it('makes one account per platform picked, each with its own login', async () => {
    const user = userEvent.setup()
    await reachReview(user)

    await user.click(screen.getByRole('button', { name: 'Instagram' }))
    await user.click(screen.getByRole('button', { name: 'YouTube' }))

    await user.click(screen.getByLabelText('Instagram handle'))
    await user.paste('@creator.ig')
    await user.click(screen.getByLabelText('Instagram email'))
    await user.paste('ig@example.com')
    await user.click(screen.getByLabelText('Instagram password'))
    await user.paste('hunter2')
    await user.click(screen.getByLabelText('YouTube handle'))
    await user.paste('@creator.yt')

    await user.click(screen.getByRole('button', { name: 'Save campaign' }))

    await waitFor(async () => {
      const [saved] = await adapter.listCampaigns()
      expect(saved).toBeDefined()
      expect(await adapter.listCampaignAccounts(saved.id)).toHaveLength(2)
    })

    const [saved] = await adapter.listCampaigns()
    const accounts = await adapter.listCampaignAccounts(saved.id)
    const instagram = accounts.find((a) => a.platform === 'Instagram')
    expect(instagram?.handle).toBe('@creator.ig')
    expect(instagram?.email).toBe('ig@example.com')
    expect(instagram?.password).toBe('hunter2')
    // The other platform keeps its own row, with nothing borrowed from the
    // first: one login per account, never one per campaign.
    const youtube = accounts.find((a) => a.platform === 'YouTube')
    expect(youtube?.handle).toBe('@creator.yt')
    expect(youtube?.email).toBeNull()
  })

  it('un-picking a platform takes its fields away again', async () => {
    const user = userEvent.setup()
    await reachReview(user)

    await user.click(screen.getByRole('button', { name: 'TikTok' }))
    expect(screen.getByLabelText('TikTok handle')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'TikTok' }))
    expect(screen.queryByLabelText('TikTok handle')).toBeNull()
  })

  it('asks how many posts a day, because no document states it', async () => {
    const user = userEvent.setup()
    await reachReview(user)

    const quota = screen.getByLabelText('Posts owed per day')
    await user.clear(quota)
    await user.type(quota, '4')
    await user.click(screen.getByRole('button', { name: 'Save campaign' }))

    await waitFor(async () => {
      const [saved] = await adapter.listCampaigns()
      expect(saved?.daily_post_quota).toBe(4)
    })
  })

  it('asks what one post pays, so a campaign no document priced still gets a rate', async () => {
    // Without this the only way to price a campaign was a contract that
    // happened to state a rate: anything else saved, landed on the brief
    // reading "no rate yet", and earned nothing on Money.
    const user = userEvent.setup()
    await reachReview(user)

    const rate = screen.getByLabelText('Dollars per post')
    expect(rate).toHaveValue('')

    await user.type(rate, '42.50')
    await user.click(screen.getByRole('button', { name: 'Save campaign' }))

    await waitFor(async () => {
      const [saved] = await adapter.listCampaigns()
      expect(saved?.pay_per_video_cents).toBe(4250)
    })
    // Through the field row too, so the brief does not show a rate beside
    // "not saved yet".
    const [saved] = await adapter.listCampaigns()
    const fields = await adapter.listCampaignFields(saved.id)
    const field = fields.find((f) => f.field_key === 'pay_per_video_cents')
    expect(field?.field_value).toBe('4250')
    expect(field?.source).toBe('user_entered')
  })

  it('leaves a blank rate blank rather than guessing one', async () => {
    const user = userEvent.setup()
    await reachReview(user)
    await user.click(screen.getByRole('button', { name: 'Save campaign' }))

    await waitFor(async () => {
      expect(await adapter.listCampaigns()).toHaveLength(1)
    })
    const [saved] = await adapter.listCampaigns()
    expect(saved.pay_per_video_cents).toBeNull()
  })

  it('keeps each password hidden as it is typed', async () => {
    const user = userEvent.setup()
    await reachReview(user)

    await user.click(screen.getByRole('button', { name: 'TikTok' }))
    expect(screen.getByLabelText('TikTok password')).toHaveAttribute('type', 'password')
  })
})
