// Which accounts the warm-up list puts first.

import { describe, expect, it } from 'vitest'

import {
  WARMUP_LIMIT_DAYS,
  WARMUP_STALE_DAYS,
  warmupLimitDays,
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

  it('treats a ready account nobody has ever warmed as overdue', () => {
    expect(warmupTier(account('ready'), null, NOW)).toBe('overdue')
  })

  it('turns overdue exactly at the platform limit, ready or warming', () => {
    const limit = warmupLimitDays(account('ready'))
    expect(warmupTier(account('ready'), ago(limit - 1), NOW)).toBe('ready')
    expect(warmupTier(account('ready'), ago(limit), NOW)).toBe('overdue')
    expect(warmupTier(account('warming'), ago(limit - 1), NOW)).toBe('building')
    expect(warmupTier(account('warming'), ago(limit), NOW)).toBe('overdue')
  })

  it('keeps a recently kept-fresh ready account out of the overdue group', () => {
    expect(warmupTier(account('ready'), ago(1), NOW)).toBe('ready')
  })
})

describe('the per-platform limits', () => {
  const on = (platform: string, status: CampaignAccount['status'] = 'ready') =>
    ({ id: `a-${platform}`, status, platform }) as CampaignAccount

  it('gives TikTok and Instagram the two-day limit he set', () => {
    expect(WARMUP_LIMIT_DAYS.TikTok).toBe(2)
    expect(WARMUP_LIMIT_DAYS.Instagram).toBe(2)
    expect(warmupTier(on('TikTok'), ago(2), NOW)).toBe('overdue')
    expect(warmupTier(on('Instagram'), ago(2), NOW)).toBe('overdue')
    expect(warmupTier(on('TikTok'), ago(1), NOW)).toBe('ready')
  })

  it('leaves every other platform on the general limit, not the two-day one', () => {
    for (const platform of ['Facebook', 'X', 'Snapchat']) {
      expect(warmupLimitDays(on(platform))).toBe(WARMUP_STALE_DAYS)
      // Three days is overdue for TikTok and perfectly fine here.
      expect(warmupTier(on(platform), ago(3), NOW)).toBe('ready')
    }
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
