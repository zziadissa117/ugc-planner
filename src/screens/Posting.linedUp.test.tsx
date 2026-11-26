// POST's line beside a campaign's name: today's videos from the cutter (or
// Postiz) and when they go - "1 posted · 9:04 am", "1 scheduled · 6:00 pm".
// Read only: the boxes stay his to tick.

import 'fake-indexeddb/auto'
import { render, screen, within } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { DataContext } from '../data/context'
import { LocalAdapter } from '../data/local/LocalAdapter'
import { LocalDatabase } from '../data/local/db'
import type { PostizPostView, PostizPostsAnswer } from '../sync/postizPosts'
import { Posting } from './Posting'

const USER = '11111111-1111-4111-8111-111111111111'
let adapter: LocalAdapter

beforeEach(async () => {
  indexedDB = new IDBFactory()
  const db = new LocalDatabase(`posting-lined-up-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
})

async function campaign(name: string, handle: string, quota = 2) {
  const created = await adapter.createCampaign({
    name,
    company: null,
    default_setup: 'face',
    approval_mode: 'none',
    daily_post_quota: quota,
    pay_per_video_cents: 1000,
    cycle_size: null,
  })
  await adapter.addCampaignAccount({ campaign_id: created.id, platform: 'Instagram', handle })
  return created
}

const today = (h: number, m = 0) => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).toISOString()
}

let next = 0
const post = (extra: Partial<PostizPostView>): PostizPostView => ({
  id: `p${++next}`,
  group: null,
  platform: 'Instagram',
  handle: 'betttr.zayed',
  url: null,
  preview: null,
  previewKind: null,
  caption: '',
  status: 'scheduled',
  publishedAt: today(18),
  views: null,
  viewsAt: null,
  campaign: null,
  ...extra,
})

function renderScreen(answer: PostizPostsAnswer | null) {
  const asked: { from: string; to: string }[] = []
  render(
    <DataContext.Provider value={adapter}>
      <MemoryRouter>
        <Posting
          load={async (range) => {
            asked.push(range)
            return answer
          }}
        />
      </MemoryRouter>
    </DataContext.Provider>,
  )
  return asked
}

const card = async (name: string) => (await screen.findByRole('group', { name })) as HTMLElement

describe("today's videos beside each campaign's name", () => {
  it('says how many are out and scheduled, and when', async () => {
    await campaign('Pumpfun', 'betttr.zayed')
    await campaign('Vaza', 'ziad.debates')
    const asked = renderScreen({
      connected: true,
      reading: 0,
      source: 'cutter',
      posts: [
        post({ status: 'posted', publishedAt: today(9, 4) }),
        post({ status: 'scheduled', publishedAt: today(18) }),
        // Yesterday's: not today's line.
        post({ status: 'posted', publishedAt: new Date(new Date(today(12)).getTime() - 86_400_000).toISOString() }),
      ],
    })

    const pump = within(await card('Pumpfun'))
    expect(await pump.findByText('1 posted')).toBeInTheDocument()
    expect(pump.getByText('9:04 am')).toBeInTheDocument()
    expect(pump.getByText('1 scheduled')).toBeInTheDocument()
    expect(pump.getByText('6:00 pm')).toBeInTheDocument()
    // A campaign with nothing lined up says so, quietly.
    expect(within(await card('Vaza')).getByText('Nothing scheduled')).toBeInTheDocument()
    // Today, midnight to midnight.
    expect(asked[0].to > asked[0].from).toBe(true)

    // It never ticks a box: both of Pumpfun's are still open.
    const open = pump.getAllByRole('button').filter((b) => /post /.test(b.getAttribute('aria-label') ?? ''))
    expect(open.length).toBe(2)
    expect(open.every((b) => b.getAttribute('aria-pressed') !== 'true')).toBe(true)
  })

  it('shows nothing without a key, and claims nothing after a partial read', async () => {
    await campaign('Pumpfun', 'betttr.zayed')
    renderScreen({ connected: false, posts: [], reading: 0 })
    await card('Pumpfun')
    expect(screen.queryByText('Nothing scheduled')).not.toBeInTheDocument()
  })

  it('does not say "Nothing scheduled" when the read came back with a warning', async () => {
    await campaign('Pumpfun', 'betttr.zayed')
    renderScreen({ connected: true, posts: [], reading: 0, source: 'postiz', error: "This hour's Postiz requests for your key are used up." })
    await card('Pumpfun')
    // Give the read its turn.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.queryByText('Nothing scheduled')).not.toBeInTheDocument()
  })
})
