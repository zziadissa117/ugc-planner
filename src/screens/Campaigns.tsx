import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import type { Campaign, CampaignAccount } from '../data'
import { useData } from '../data/useData'
import { dailyEarningsCents, formatCents } from '../money'

/** Every campaign at a glance: what it pays a day, and where it posts. One
 *  compact row each - the two facts he checks before opening one. */
export function Campaigns() {
  const data = useData()
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [accounts, setAccounts] = useState<CampaignAccount[]>([])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [rows, theirAccounts] = await Promise.all([
        data.listCampaigns(),
        data.listCampaignAccounts(),
      ])
      if (cancelled) return
      setCampaigns(rows)
      setAccounts(theirAccounts)
    })()
    return () => {
      cancelled = true
    }
  }, [data])

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-3">
      <h1 className="text-xl font-semibold text-text">Briefs</h1>

      {campaigns === null ? null : campaigns.length === 0 ? (
        <p className="text-sm text-state-later">No campaigns yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {campaigns.map((campaign) => {
            const platforms = accounts
              .filter((a) => a.campaign_id === campaign.id)
              .map((a) => a.platform)
            const perDay = dailyEarningsCents(campaign)
            return (
              <li key={campaign.id}>
                <Link
                  to={`/campaigns/${campaign.id}`}
                  className="flex min-h-tap items-center justify-between gap-3 rounded-lg border border-edge bg-surface px-3 py-2 active:bg-surface-raised"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-text">{campaign.name}</span>
                    <span className="block truncate text-xs text-state-later">
                      {platforms.length === 0 ? 'no platforms yet' : platforms.join(' · ')}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-semibold tabular-nums text-text">
                      {perDay === null ? 'no rate' : `${formatCents(perDay)}/day`}
                    </span>
                    <span className="block text-xs tabular-nums text-state-later">
                      {campaign.daily_post_quota}/day
                    </span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      <Link
        to="/campaigns/new"
        className="flex min-h-tap items-center justify-center rounded-lg border border-edge bg-surface px-4 text-sm font-semibold text-text active:bg-surface-raised"
      >
        + New campaign
      </Link>
    </section>
  )
}
