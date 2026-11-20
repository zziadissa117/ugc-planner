import { describe, expect, it } from 'vitest'

import { cutterCampaignFor, readSince, summariseViews, viewFlag, type CutterViewsPost } from './campaignViews'

const NOW = new Date(2026, 10, 20, 12, 0, 0) // Nov 20, noon
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

const tiktok = { name: 'Login TikTok', platform: 'TikTok', profile: 'login.tt' }
const insta = { name: 'Login IG', platform: 'Instagram', profile: 'login.ig' }

function post(id: string, ageHours: number, views: Record<string, number | null>): CutterViewsPost {
  return { id, postedAt: hoursAgo(ageHours), accounts: [tiktok, insta], views }
}

describe('the flag', () => {
  it('says the lowest of 100, 200 and 500 the account is under', () => {
    expect(viewFlag(50)).toBe(100)
    expect(viewFlag(150)).toBe(200)
    expect(viewFlag(199)).toBe(200)
    expect(viewFlag(200)).toBe(500)
    expect(viewFlag(499)).toBe(500)
    expect(viewFlag(500)).toBeNull()
    expect(viewFlag(null)).toBeNull()
  })
})

describe("a campaign's views", () => {
  it("adds up the month, and each account's last 24 hours from yesterday's posts", () => {
    const views = summariseViews(
      [
        post('yesterday', 30, { 'Login TikTok': 150, 'Login IG': 900 }),
        post('this morning', 3, { 'Login TikTok': null, 'Login IG': null }), // not read yet
        post('last week', 24 * 6, { 'Login TikTok': 4000, 'Login IG': 1000 }),
      ],
      NOW,
    )
    expect(views.monthViews).toBe(150 + 900 + 4000 + 1000)
    expect(views.monthPosts).toBe(3)
    expect(views.monthUnread).toBe(1)
    const byPlatform = Object.fromEntries(views.accounts.map((a) => [a.platform, a]))
    expect(byPlatform.TikTok.last24).toBe(150)
    expect(byPlatform.TikTok.label).toBe('@login.tt')
    expect(byPlatform.Instagram.last24).toBe(900)
  })

  it('leaves last month out of the month, and says when nothing has been read yet', () => {
    const early = new Date(2026, 10, 1, 10, 0, 0)
    const views = summariseViews(
      [{ id: 'oct', postedAt: new Date(2026, 9, 31, 8, 0, 0).toISOString(), accounts: [tiktok], views: {} }],
      early,
    )
    expect(views.monthPosts).toBe(0)
    expect(views.accounts[0].last24).toBeNull()
    expect(views.accounts[0].posts).toBe(1)
    // Early in a month the window reaches back into the last one.
    expect(Date.parse(readSince(early))).toBeLessThan(new Date(2026, 10, 1).getTime())
  })
})

describe('which cutter campaign', () => {
  it('is the linked one, else the one with the same name', () => {
    const cutter = [{ id: 'c1', name: 'LOGIN!' }, { id: 'c2', name: 'Other' }]
    expect(cutterCampaignFor({ name: 'Login', cutter_campaign_id: null }, cutter)).toBe('c1')
    expect(cutterCampaignFor({ name: 'Login', cutter_campaign_id: 'linked' }, cutter)).toBe('linked')
    expect(cutterCampaignFor({ name: 'Nope', cutter_campaign_id: null }, cutter)).toBeNull()
  })
})
