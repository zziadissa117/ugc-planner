import { describe, expect, it } from 'vitest'

import { homeKey, homeOfPost } from './postHome'

const campaign = (id: string, name: string, cutter: string | null = null, active = true) => ({
  id,
  name,
  is_active: active,
  cutter_campaign_id: cutter,
})
const account = (id: string, campaignId: string, platform: string, handle: string, active = true) => ({
  id,
  campaign_id: campaignId,
  platform,
  handle,
  is_active: active,
})

const campaigns = [
  campaign('cantina', 'Cantina', 'cut-cantina'),
  campaign('pump', 'Pumpfun'),
  campaign('pump-2', 'Pump.fun reactions'),
  campaign('old', 'Archived', null, false),
]
const accounts = [
  account('a-cantina-ig', 'cantina', 'Instagram', 'hooksandmike'),
  account('a-pump-tt', 'pump', 'TikTok', '@betttr.zayed'),
  account('a-pump2-tt', 'pump-2', 'TikTok', 'betttr.zayed'),
  account('a-old', 'old', 'TikTok', 'oldhandle'),
]

describe('which campaign a post belongs to', () => {
  it('follows the link to the cutter campaign first', () => {
    expect(
      homeOfPost({ platform: 'Instagram', handle: 'hooksandmike', campaign: { id: 'cut-cantina', name: 'Cantina' } }, campaigns, accounts),
    ).toEqual({ kind: 'campaign', campaignId: 'cantina', accountId: 'a-cantina-ig' })
    // Linked, on an account the planner does not list: still that campaign.
    expect(homeOfPost({ platform: 'YouTube', handle: 'x', campaign: { id: 'cut-cantina', name: 'Cantina' } }, campaigns, accounts)).toEqual({
      kind: 'campaign',
      campaignId: 'cantina',
      accountId: null,
    })
  })

  it('places a post by its exact account, preferring the campaign named like the cutter one', () => {
    expect(homeOfPost({ platform: 'TikTok', handle: 'betttr.zayed', campaign: null }, campaigns, accounts)).toMatchObject({ campaignId: 'pump' })
    expect(
      homeOfPost({ platform: 'TikTok', handle: 'betttr.zayed', campaign: { id: 'cut-x', name: 'Pump.fun Reactions' } }, campaigns, accounts),
    ).toMatchObject({ campaignId: 'pump-2', accountId: 'a-pump2-tt' })
  })

  it("never gives a cutter post to a campaign linked to another cutter campaign", () => {
    // hooksandmike is Cantina's, but Cantina is the cutter's Cantina - not Trial reels.
    expect(
      homeOfPost({ platform: 'Instagram', handle: 'hooksandmike', campaign: { id: 'cut-trial', name: 'Trial reels' } }, campaigns, accounts),
    ).toEqual({ kind: 'cutter', cutterId: 'cut-trial', name: 'Trial reels' })
  })

  it('keeps a cutter campaign the planner does not have under its own name', () => {
    const home = homeOfPost({ platform: 'Instagram', handle: 'traderzi2', campaign: { id: 'cut-gd', name: ' GoDaddy traderzi2 ' } }, campaigns, accounts)
    expect(home).toEqual({ kind: 'cutter', cutterId: 'cut-gd', name: 'GoDaddy traderzi2' })
    expect(homeKey(home)).toBe('cutter:cut-gd')
  })

  it('guesses nothing: no near-miss handle, no archived campaign, no platform-only match', () => {
    expect(homeOfPost({ platform: 'TikTok', handle: 'betttr.zayed2', campaign: null }, campaigns, accounts)).toEqual({ kind: 'none' })
    expect(homeOfPost({ platform: 'TikTok', handle: 'oldhandle', campaign: null }, campaigns, accounts)).toEqual({ kind: 'none' })
    expect(homeOfPost({ platform: 'Instagram', handle: 'betttr.zayed', campaign: null }, campaigns, accounts)).toEqual({ kind: 'none' })
    expect(homeKey({ kind: 'none' })).toBe('none')
  })
})
