// The brief page must never present eight angles as one authored list.
//
// The data-layer test already proves the two sets are stored separately. This
// one proves the rendered page keeps them apart, which is where the mistake
// would actually be visible to him: two headed sections, six rows under one
// and two under the other, and no list anywhere containing all eight.

import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { DataContext } from '../data/context'
import type { DataAdapter } from '../data/DataAdapter'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { INFLOW_CAMPAIGN_ID, ensureSeeded } from '../data/seed'
import { Campaign } from './Campaign'

const USER = '11111111-1111-4111-8111-111111111111'

let adapter: DataAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`brief-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
  await ensureSeeded(adapter)
})

async function renderBrief() {
  render(
    <DataContext.Provider value={adapter}>
      <MemoryRouter initialEntries={[`/campaigns/${INFLOW_CAMPAIGN_ID}`]}>
        <Routes>
          <Route path="/campaigns/:campaignId" element={<Campaign />} />
        </Routes>
      </MemoryRouter>
    </DataContext.Provider>,
  )
  // The page loads its data in an effect, so wait for the heading to arrive.
  await screen.findByRole('heading', { name: 'Inflow' })
}

const BRIEF_ANGLES = [
  'A. Frozen funds',
  'B. Waiting for your own money',
  'C. Your country is not supported',
  'D. Taxes handled',
  'E. The real rate',
  'F. You use it too',
]

const SKILL_FILE_ANGLES = ['Nobody picks up', 'Switching is not a project']

describe('the brief page', () => {
  it('renders the six brief angles and the two skill-file angles in separate lists', async () => {
    await renderBrief()

    const briefList = screen.getByRole('list', { name: /from the brief/i })
    const skillList = screen.getByRole('list', { name: /from your skill file/i })
    expect(briefList).not.toBe(skillList)

    expect(within(briefList).getAllByRole('listitem')).toHaveLength(6)
    expect(within(skillList).getAllByRole('listitem')).toHaveLength(2)

    for (const label of BRIEF_ANGLES) {
      expect(within(briefList).getByText(label)).toBeInTheDocument()
      expect(within(skillList).queryByText(label)).toBeNull()
    }
    for (const label of SKILL_FILE_ANGLES) {
      expect(within(skillList).getByText(label)).toBeInTheDocument()
      expect(within(briefList).queryByText(label)).toBeNull()
    }
  })

  it('has no list anywhere on the page holding all eight angles', async () => {
    await renderBrief()

    const allAngles = [...BRIEF_ANGLES, ...SKILL_FILE_ANGLES]
    for (const list of screen.getAllByRole('list')) {
      const present = allAngles.filter((label) => within(list).queryByText(label) !== null)
      // A list may hold six, or two, but never the merged eight.
      expect(present.length).toBeLessThan(allAngles.length)
    }
  })

  it('says plainly that the skill-file angles are not in the brief', async () => {
    await renderBrief()

    const heading = screen.getByRole('heading', { name: /from your skill file - not in the brief/i })
    expect(heading).toBeInTheDocument()
  })

  it('warns that the brief is incomplete', async () => {
    await renderBrief()
    expect(screen.getByText(/this brief looks incomplete/i)).toBeInTheDocument()
  })

  it('renders a missing field as "not saved yet" rather than blank or guessed', async () => {
    await renderBrief()

    // submission_url is one of the SPEC section 12 blanks.
    const label = screen.getByText('submission url')
    const row = label.closest('div')
    expect(row).not.toBeNull()
    expect(within(row!).getByText('not saved yet')).toBeInTheDocument()
  })
})
