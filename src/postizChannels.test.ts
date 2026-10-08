import { describe, expect, it } from 'vitest'

import { channelRow, channelSummary, type PostizAccount } from './postizChannels'

const account = (over: Partial<PostizAccount> = {}): PostizAccount => ({
  id: 'tt',
  name: 'Inflow TikTok',
  platform: 'tiktok',
  profile: '@inflow',
  disabled: false,
  alsoUsedBy: [],
  scheduled: 0,
  ...over,
})

const none = new Set<string>()

describe('freeing channels when a campaign is archived', () => {
  it('asks him to disable a connected account nothing else needs', () => {
    expect(channelRow(account(), 'free', none)).toMatchObject({ tone: 'now', todo: true, state: 'connected - disable it' })
  })

  it('leaves one already disabled alone', () => {
    expect(channelRow(account({ disabled: true }), 'free', none)).toMatchObject({ tone: 'later', todo: false, state: 'disabled' })
  })

  it('says keep when a live campaign still posts to it', () => {
    const shared = account({ alsoUsedBy: [{ id: 'cut-vertus', name: 'Vertus' }] })
    expect(channelRow(shared, 'free', new Set(['cut-vertus']))).toMatchObject({
      tone: 'later',
      todo: false,
      state: 'keep - Vertus still posts here',
    })
  })

  it('does not hold an account for a campaign that is itself finished, but mentions it', () => {
    const shared = account({ alsoUsedBy: [{ id: 'cut-old', name: 'Old' }] })
    expect(channelRow(shared, 'free', none)).toMatchObject({
      todo: true,
      note: 'also set up for Old in the cutter',
    })
  })

  it('reads an account Postiz no longer has as nothing to do', () => {
    expect(channelRow(account({ disabled: null }), 'free', none)).toMatchObject({ todo: false, state: 'not in Postiz any more' })
  })
})

describe('switching channels back on when a campaign is restored', () => {
  it('asks for the disabled ones only', () => {
    expect(channelRow(account({ disabled: true }), 'restore', none)).toMatchObject({ tone: 'now', todo: true })
    expect(channelRow(account(), 'restore', none)).toMatchObject({ tone: 'later', todo: false, state: 'connected' })
  })
})

describe('channelSummary', () => {
  it('counts what is left to do, the posts that would fail, and the channels in use', () => {
    const summary = channelSummary(
      [
        {
          id: 'p1',
          inUse: 24,
          accounts: [
            account({ scheduled: 2 }),
            account({ id: 'ig', disabled: true, scheduled: 5 }),
            account({ id: 'yt', alsoUsedBy: [{ id: 'live', name: 'Vertus' }], scheduled: 3 }),
          ],
        },
      ],
      'free',
      new Set(['live']),
    )
    expect(summary).toMatchObject({ todo: 1, atRisk: 2, inUse: 24, errors: [] })
  })

  it('keeps going past a profile that could not be read, and says why', () => {
    const summary = channelSummary(
      [{ id: 'p1', error: "Postiz didn't accept your key" }, { id: 'p2', inUse: 3, accounts: [account()] }],
      'free',
      none,
    )
    expect(summary.errors).toEqual(["Postiz didn't accept your key"])
    expect(summary.inUse).toBeNull()
    expect(summary.todo).toBe(1)
  })
})
