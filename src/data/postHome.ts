// Which campaign a post belongs to - one rule for TODAY's "Going out" and
// IDEATE, so the two never disagree about where a video went.
//
// A post read from the cutter's records names the cutter campaign it was
// made for; one read from Postiz names only an account. In order:
//
//   1. the planner campaign linked to that cutter campaign
//      (campaigns.cutter_campaign_id);
//   2. the planner campaign one of whose switched-on accounts is exactly the
//      post's platform and handle (mineFor - no near-miss spelling, no "only
//      account on that platform"). A campaign linked to a different cutter
//      campaign is not considered for a cutter post: the account may be
//      shared, the campaign is not. When two campaigns share the account, the
//      one named like the cutter campaign wins, else the first in the order
//      given;
//   3. the cutter campaign itself, by its own name, when the planner has no
//      campaign for it - his videos still count somewhere he can see them;
//   4. nowhere ("Other accounts").
//
// Nothing is invented: a post the rules cannot place is left unplaced, never
// put on the nearest campaign.

import { mineFor } from './campaignViews'
import type { Campaign, CampaignAccount } from './schema'

/** Just what placing a post needs. PostizPostView has all of it. */
export interface PlaceablePost {
  platform: string
  handle: string
  campaign: { id: string; name: string } | null
}

export type PostHome =
  /** One of the planner's campaigns. */
  | { kind: 'campaign'; campaignId: string; accountId: string | null }
  /** A cutter campaign the planner has no campaign for. */
  | { kind: 'cutter'; cutterId: string; name: string }
  | { kind: 'none' }

const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

export function homeOfPost(
  post: PlaceablePost,
  campaigns: readonly Pick<Campaign, 'id' | 'name' | 'is_active' | 'cutter_campaign_id'>[],
  accounts: readonly Pick<CampaignAccount, 'id' | 'campaign_id' | 'platform' | 'handle' | 'is_active'>[],
): PostHome {
  const live = campaigns.filter((c) => c.is_active !== false)
  const cutter = post.campaign

  if (cutter) {
    const linked = live.find((c) => c.cutter_campaign_id === cutter.id)
    if (linked) {
      const account = mineFor(
        accounts.filter((a) => a.campaign_id === linked.id && a.is_active),
        { name: post.handle, platform: post.platform, profile: post.handle },
      )
      return { kind: 'campaign', campaignId: linked.id, accountId: account?.id ?? null }
    }
  }

  const open = cutter ? live.filter((c) => !c.cutter_campaign_id || c.cutter_campaign_id === cutter.id) : live
  const matches = open.flatMap((campaign) => {
    const account = mineFor(
      accounts.filter((a) => a.campaign_id === campaign.id && a.is_active),
      { name: post.handle, platform: post.platform, profile: post.handle },
    )
    return account ? [{ campaign, account }] : []
  })
  if (matches.length > 0) {
    const named = cutter ? matches.find((m) => nameKey(m.campaign.name) === nameKey(cutter.name)) : undefined
    const pick = named ?? matches[0]
    return { kind: 'campaign', campaignId: pick.campaign.id, accountId: pick.account.id }
  }

  if (cutter) return { kind: 'cutter', cutterId: cutter.id, name: cutter.name.trim() || 'Cutter campaign' }
  return { kind: 'none' }
}

/** A stable key for a home: the planner campaign's id, `cutter:<id>`, or
 *  'none'. */
export function homeKey(home: PostHome): string {
  if (home.kind === 'campaign') return home.campaignId
  if (home.kind === 'cutter') return `cutter:${home.cutterId}`
  return 'none'
}
