// The Postiz channels a finished campaign still holds. The planner cannot
// disable them (Postiz's API only deletes accounts for good), so this is a
// guided list he works through in Postiz, checking again here afterwards.

import 'fake-indexeddb/auto'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Campaign, DataAdapter } from '../data'
import { DataContext } from '../data/context'
import { LocalDatabase } from '../data/local/db'
import { LocalAdapter } from '../data/local/LocalAdapter'
import type { PostizProfile } from '../postizChannels'
import { PostizChannels } from './PostizChannels'

const USER = '11111111-1111-4111-8111-111111111111'

const channels = vi.fn<(cutterCampaignId: string) => Promise<PostizProfile[] | null>>()
vi.mock('../sync/plannerPostiz', async (original) => ({
  ...(await original<typeof import('../sync/plannerPostiz')>()),
  postizChannels: (id: string) => channels(id),
}))

let adapter: DataAdapter
let inflow: Campaign

async function campaign(name: string, cutter: string | null): Promise<Campaign> {
  const row = await adapter.createCampaign({
    name,
    company: null,
    default_setup: 'face',
    approval_mode: 'none',
    pay_per_video_cents: 2000,
    cycle_size: null,
  })
  return adapter.updateCampaign(row.id, { cutter_campaign_id: cutter })
}

beforeEach(async () => {
  indexedDB = new IDBFactory()
  localStorage.clear()
  channels.mockReset()
  const db = new LocalDatabase(`postiz-${crypto.randomUUID()}`)
  adapter = new LocalAdapter(db, USER)
  await db.open()
  inflow = await campaign('Inflow', 'cut-inflow')
  await campaign('Vertus', 'cut-vertus')
})

const account = (id: string, over: Partial<NonNullable<PostizProfile['accounts']>[number]> = {}) => ({
  id,
  name: id,
  platform: 'tiktok',
  profile: `@${id}`,
  disabled: false,
  alsoUsedBy: [],
  scheduled: 0,
  ...over,
})

function show(mode: 'free' | 'restore' = 'free') {
  render(
    <DataContext.Provider value={adapter}>
      <PostizChannels campaign={inflow} mode={mode} />
    </DataContext.Provider>,
  )
}

describe('freeing an archived campaign\'s Postiz channels', () => {
  it('lists what to disable, what to keep for a live campaign, and the plan count', async () => {
    channels.mockResolvedValue([
      {
        id: 'p1',
        inUse: 24,
        accounts: [
          account('inflow-tt'),
          account('inflow-ig', { disabled: true }),
          account('shared-yt', { alsoUsedBy: [{ id: 'cut-vertus', name: 'Vertus' }] }),
        ],
      },
    ])
    show()

    const list = await screen.findByRole('list', { name: 'Postiz accounts' })
    expect(channels).toHaveBeenCalledWith('cut-inflow')
    expect(within(list).getByText('connected - disable it')).toBeInTheDocument()
    expect(within(list).getByText('disabled')).toBeInTheDocument()
    expect(within(list).getByText('keep - Vertus still posts here')).toBeInTheDocument()
    expect(screen.getByText('Channels in use: 24 of 30')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Postiz' })).toHaveAttribute('href', expect.stringContaining('postiz.com'))
  })

  it('warns, in red words, about posts that would fail', async () => {
    channels.mockResolvedValue([{ id: 'p1', inUse: 5, accounts: [account('tt', { scheduled: 3 })] }])
    show()
    expect(await screen.findByText(/3 posts are still due on these/)).toBeInTheDocument()
  })

  it('checks again after he has been to Postiz', async () => {
    const user = userEvent.setup()
    channels.mockResolvedValueOnce([{ id: 'p1', inUse: 25, accounts: [account('tt')] }])
    show()
    await screen.findByText('connected - disable it')

    channels.mockResolvedValueOnce([{ id: 'p1', inUse: 24, accounts: [account('tt', { disabled: true })] }])
    await user.click(screen.getByRole('button', { name: 'Check again' }))

    expect(await screen.findByText('Nothing left to switch off.')).toBeInTheDocument()
    expect(screen.getByText('Channels in use: 24 of 30')).toBeInTheDocument()
  })

  it('says why when the check fails', async () => {
    channels.mockRejectedValue(new Error('The cutter is not updated for this yet - run ./deploy-server.sh in silence-cutter.'))
    show()
    expect(await screen.findByText(/run \.\/deploy-server\.sh/)).toBeInTheDocument()
  })

  it('shows nothing at all to anyone but the owner', async () => {
    channels.mockResolvedValue(null)
    show()
    await waitFor(() => expect(channels).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText('Free its Postiz channels')).toBeNull())
  })
})

describe('restoring a campaign', () => {
  it('asks him to switch the disabled ones back on', async () => {
    channels.mockResolvedValue([{ id: 'p1', inUse: 20, accounts: [account('tt', { disabled: true }), account('ig')] }])
    show('restore')
    expect(await screen.findByText('disabled - switch it back on')).toBeInTheDocument()
    expect(screen.getByText('connected')).toBeInTheDocument()
  })
})
