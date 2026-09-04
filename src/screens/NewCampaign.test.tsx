import 'fake-indexeddb/auto'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import type { DataAdapter } from '../data'
import { DataContext } from '../data/context'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { NewCampaign } from './NewCampaign'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: DataAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`drop-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
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

  it('says the server parser is not deployed and what to do instead', async () => {
    renderDropBox()
    expect(screen.getByText(/server parser is not deployed yet/i)).toBeInTheDocument()
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
