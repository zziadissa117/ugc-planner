import { describe, expect, it } from 'vitest'

import { cutterCampaignFor, mineFor, readSince, summariseViews, viewFlag, type CutterViewsPost, type MyAccount } from './campaignViews'

const NOW = new Date(2026, 10, 20, 12, 0, 0) // Nov 20, noon
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

// His accounts, as saved on the planner campaign.
const mine: MyAccount[] = [
  { id: 'my-tt', platform: 'TikTok', handle: '@lockinwithziad' },
  { id: 'my-ig', platform: 'Instagram', handle: 'ziad.login' },
]
// The same campaign in the cutter, shared with Jake: his posts and Jake's.
const zTT = { name: 'Ziad TikTok', platform: 'TikTok', profile: 'lockinwithziad' }
const zIG = { name: 'Ziad IG', platform: 'Instagram', profile: '@Ziad.Login' }
const jTT = { name: 'Jake TikTok', platform: 'TikTok', profile: 'hooksandmike' }
const jIG = { name: 'Jake IG', platform: 'Instagram', profile: 'jake.login' }

function post(id: string, ageHours: number, accounts: CutterViewsPost['accounts'], views: CutterViewsPost['views']): CutterViewsPost {
  return { id, postedAt: hoursAgo(ageHours), accounts, views }
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

describe('whose account it is', () => {
  it('is his only on the same platform with exactly his handle', () => {
    expect(mineFor(mine, zTT)?.id).toBe('my-tt')
    expect(mineFor(mine, zIG)?.id).toBe('my-ig') // "@" and capitals do not matter
    expect(mineFor(mine, jTT)).toBeNull() // Jake's, even though it is the only other TikTok
    expect(mineFor(mine, { name: 'x', platform: 'Instagram', profile: 'lockinwithziad' })).toBeNull() // wrong platform
    expect(mineFor(mine, { name: '', platform: 'TikTok', profile: '' })).toBeNull() // nothing to go by
  })

  it('never counts anything for an account he has not saved a handle for', () => {
    const noHandle: MyAccount[] = [{ id: 'yt', platform: 'YouTube', handle: null }]
    expect(mineFor(noHandle, { name: 'Jake YT', platform: 'YouTube', profile: 'jakeyt' })).toBeNull()
  })
})

describe("a campaign's views", () => {
  const posts = [
    // Yesterday: his post and Jake's post, both on the same cutter campaign.
    post('mine-yesterday', 30, [zTT, zIG], { 'Ziad TikTok': 150, 'Ziad IG': 900 }),
    post('jakes-yesterday', 29, [jTT, jIG], { 'Jake TikTok': 50_000, 'Jake IG': 20_000 }),
    post('mine-this-morning', 3, [zTT, zIG], {}), // not read yet
    post('mine-last-week', 24 * 6, [zTT, zIG], { 'Ziad TikTok': 4000, 'Ziad IG': 1000 }),
    post('jakes-last-week', 24 * 6, [jTT], { 'Jake TikTok': 99_000 }),
  ]

  it("counts only his accounts' views - never Jake's", () => {
    const views = summariseViews(posts, mine, NOW)
    expect(views.monthViews).toBe(150 + 900 + 4000 + 1000)
    expect(views.monthPosts).toBe(3)
    expect(views.monthUnread).toBe(1)
    const byId = Object.fromEntries(views.accounts.map((a) => [a.key, a]))
    expect(byId['my-tt'].last24).toBe(150)
    expect(byId['my-tt'].label).toBe('@lockinwithziad')
    expect(byId['my-ig'].last24).toBe(900)
    expect(views.accounts).toHaveLength(2) // Jake's accounts are not listed at all
  })

  it('leaves last month out of the month, and says when nothing has been read yet', () => {
    const early = new Date(2026, 10, 1, 10, 0, 0)
    const views = summariseViews(
      [{ id: 'oct', postedAt: new Date(2026, 9, 31, 8, 0, 0).toISOString(), accounts: [zTT], views: {} }],
      mine,
      early,
    )
    expect(views.monthPosts).toBe(0)
    const tt = views.accounts.find((a) => a.key === 'my-tt')!
    expect(tt.last24).toBeNull()
    expect(tt.posts).toBe(1)
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
