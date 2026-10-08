// One login for every account of a campaign, or one each.
//
// The login lives on each campaign_accounts row (a login belongs to an
// account, never to a campaign). "Same for all" is a way of looking at those
// rows: the same email and password written to every one. These decide which
// way a campaign's accounts already are, and which login a "same for all"
// view starts from. Pure, for the tests; the screen is AccountsEditor.tsx.

import type { CampaignAccount } from './index'

/** True when every account has the same email and the same password - which
 *  includes none having any yet. */
export function loginsMatch(accounts: readonly CampaignAccount[]): boolean {
  if (accounts.length === 0) return true
  const [first] = accounts
  return accounts.every((a) => (a.email ?? '') === (first.email ?? '') && (a.password ?? '') === (first.password ?? ''))
}

/** The login a "same for all" view starts from: the first account that has
 *  one, so an empty row added later never wipes the others. */
export function sharedLogin(accounts: readonly CampaignAccount[]): { email: string; password: string; from: CampaignAccount | null } {
  const from = accounts.find((a) => (a.email ?? '') !== '' || (a.password ?? '') !== '') ?? null
  return { email: from?.email ?? '', password: from?.password ?? '', from }
}

