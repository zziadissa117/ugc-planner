// The FILM console, and the strip pinned to the top of it.
//
// "i want a widget that i can see no matter where i scroll on the app that
// tells me what i need to say pretty much on the campaign, 4-5 lines of things
// i need to mention FOR that specific campaign."

import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'

import type { Campaign as CampaignRow } from '../data'
import { DataContext } from '../data/context'
import type { DataAdapter } from '../data/DataAdapter'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { Console } from './Console'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: DataAdapter
let campaign: CampaignRow
let workSessionId: string

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`console-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()

  campaign = await adapter.createCampaign({
    name: 'Vertus',
    company: null,
    default_setup: 'face',
    approval_mode: 'none',
    daily_post_quota: 2,
    pay_per_video_cents: 4000,
    cycle_size: null,
  })
  const session = await adapter.startWorkSession({
    campaign_id: campaign.id,
    kind: 'film',
    goal_videos: 5,
    planned_minutes: 120,
    ended_at: null,
  })
  workSessionId = session.id
})

async function setField(key: string, value: string) {
  await adapter.setCampaignField({
    campaign_id: campaign.id,
    field_key: key,
    field_value: value,
    source: 'user_entered',
    source_quote: null,
    source_document_id: null,
  })
}

function renderConsole() {
  return render(
    <DataContext.Provider value={adapter}>
      <Console campaign={campaign} goal={5} workSessionId={workSessionId} onFinish={() => {}} />
    </DataContext.Provider>,
  )
}

describe('the pinned "say this" strip', () => {
  it('shows nothing when the campaign has no points and no structure', async () => {
    renderConsole()
    expect(await screen.findByRole('button', { name: 'Filmed one' })).toBeInTheDocument()
    expect(screen.queryByText('Say this')).toBeNull()
  })

  it('lists his own talking points, one per line, and numbers them', async () => {
    await setField(
      'talking_points',
      'Vertus says it reasons instead of predicting\nTeam came from aerospace and defense\nReportedly tested in high-stakes places already\nOpening to the public through a waitlist',
    )

    renderConsole()
    expect(await screen.findByText('Say this')).toBeInTheDocument()

    const strip = screen.getByText('Say this').closest('div')!
    const points = within(strip).getAllByRole('listitem')
    expect(points).toHaveLength(4)
    expect(points[0]).toHaveTextContent('1')
    expect(points[0]).toHaveTextContent('Vertus says it reasons instead of predicting')
    expect(points[3]).toHaveTextContent('Opening to the public through a waitlist')
  })

  it('strips the bullet he pasted in with them', async () => {
    await setField('talking_points', '- First thing\n* Second thing\n• Third thing')

    renderConsole()
    await screen.findByText('Say this')
    expect(screen.getByText('First thing')).toBeInTheDocument()
    expect(screen.getByText('Second thing')).toBeInTheDocument()
    expect(screen.getByText('Third thing')).toBeInTheDocument()
  })

  it('falls back to how the video goes when he has written no points', async () => {
    // Better than a gap mid-take, and it is the same question asked by the
    // parser rather than by him.
    await setField('structure', 'Problem first\nThen what fixed it\nThen the number')

    renderConsole()
    expect(await screen.findByText('Say this')).toBeInTheDocument()
    expect(screen.getByText('Then what fixed it')).toBeInTheDocument()
  })

  it('prefers his own points over the parsed structure', async () => {
    await setField('structure', 'Parsed structure line')
    await setField('talking_points', 'His own line')

    renderConsole()
    await screen.findByText('Say this')

    // Scoped to the strip: `structure` is also rendered further down under
    // what he can say, which is correct and not what this is about.
    const strip = screen.getByText('Say this').closest('div')!
    expect(within(strip).getByText('His own line')).toBeInTheDocument()
    expect(within(strip).queryByText('Parsed structure line')).toBeNull()
  })

  it('caps a long list rather than filling the screen with a script', async () => {
    await setField('talking_points', Array.from({ length: 12 }, (_, i) => `Point ${i + 1}`).join('\n'))

    renderConsole()
    await screen.findByText('Say this')
    const strip = screen.getByText('Say this').closest('div')!
    // Eight, not six: the brief is asked for at least six, and a six-line cap
    // would clip every list that did as it was told.
    expect(within(strip).getAllByRole('listitem')).toHaveLength(8)
  })

  it('folds away between takes, and says how many are behind it', async () => {
    await setField('talking_points', 'One\nTwo\nThree')

    const user = userEvent.setup()
    renderConsole()
    await screen.findByText('Say this')

    await user.click(screen.getByRole('button', { name: /Say this/ }))
    expect(screen.getByText('3 points')).toBeInTheDocument()
    expect(screen.queryByText('Two')).toBeNull()
  })
})
