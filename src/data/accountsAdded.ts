// Whether a campaign's accounts are in.
//
// "If you're going to run a campaign, add your accounts now. Don't wait." The
// red warning on the new-campaign page, the campaign page and the Campaigns
// tile all ask this one question, so they cannot disagree about it.
//
// An account counts once it is switched on and has a username: a platform
// picked with nothing typed under it is not an account anyone can log into.

import type { CampaignAccount } from './schema'

export function hasAccountsAdded(
  accounts: readonly Pick<CampaignAccount, 'campaign_id' | 'is_active' | 'handle'>[],
  campaignId: string,
): boolean {
  return accounts.some(
    (account) => account.campaign_id === campaignId && account.is_active && (account.handle ?? '').trim() !== '',
  )
}
