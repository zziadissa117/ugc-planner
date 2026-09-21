// Which accounts the warm-up list puts first.

import { describe, expect, it } from 'vitest'

import {
  WARMUP_STALE_DAYS,
  compareWarmupPriority,
  daysSince,
  warmupTier,
} from './warmup'
import type { CampaignAccount } from './schema'

const NOW = Date.parse('2026-09-20T12:00:00.000Z')
const DAY = 86_400_000

const ago = (days: number) => new Date(NOW - days * DAY).toISOString()

function account(status: CampaignAccount['status']): CampaignAccount {
  return { id: `a-${status}`, status } as CampaignAccount
}

describe('warmupTier', () => {
  it('puts a new account in the urgent group however recently it was touched', () => {
    expect(warmupTier(account('new'), null, NOW)).toBe('urgent')
    expect(warmupTier(account('new'), ago(0), NOW)).toBe('urgent')
  })

  it('treats a ready account nobody has ever warmed as neglected', () => {
    expect(warmupTier(account('ready'), null, NOW)).toBe('urgent')
  })

  it('turns urgent exactly at the stale threshold, ready or warming', () => {
    const justInside = ago(WARMUP_STALE_DAYS - 1)
    const justOutside = ago(WARMUP_STALE_DAYS)
    expect(warmupTier(account('ready'), justInside, NOW)).toBe('ready')
    expect(warmupTier(account('ready'), justOutside, NOW)).toBe('urgent')
    expect(warmupTier(account('warming'), justInside, NOW)).toBe('building')
    expect(warmupTier(account('warming'), justOutside, NOW)).toBe('urgent')
  })

  it('keeps a recently kept-fresh ready account out of the urgent group', () => {
    expect(warmupTier(account('ready'), ago(1), NOW)).toBe('ready')
  })
})

describe('compareWarmupPriority', () => {
  const order = (items: { account: CampaignAccount; last: string | null }[]) =>
    [...items].sort(compareWarmupPriority).map((item) => `${item.account.status}:${item.last}`)

  it('puts a new account before a neglected one', () => {
    expect(
      order([
        { account: account('ready'), last: ago(40) },
        { account: account('new'), last: null },
      ]),
    ).toEqual(['new:null', `ready:${ago(40)}`])
  })

  it('puts whichever was left longest first, and never-warmed before all of them', () => {
    const sorted = order([
      { account: account('ready'), last: ago(3) },
      { account: account('ready'), last: ago(30) },
      { account: account('ready'), last: null },
    ])
    expect(sorted).toEqual(['ready:null', `ready:${ago(30)}`, `ready:${ago(3)}`])
  })
})

describe('daysSince', () => {
  it('counts whole days', () => {
    expect(daysSince(ago(3), NOW)).toBe(3)
    expect(daysSince(new Date(NOW - 5 * 3_600_000).toISOString(), NOW)).toBe(0)
  })
})
