import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import type { Campaign } from '../data'
import { useData } from '../data/useData'

export function Campaigns() {
  const data = useData()
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void data.listCampaigns().then((rows) => {
      if (!cancelled) setCampaigns(rows)
    })
    return () => {
      cancelled = true
    }
  }, [data])

  return (
    <section className="mx-auto flex max-w-screen-sm flex-col gap-4">
      <h1 className="text-2xl font-semibold text-text">Briefs</h1>

      {campaigns === null ? null : campaigns.length === 0 ? (
        <p className="text-state-later">No campaigns yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {campaigns.map((campaign) => (
            <li key={campaign.id}>
              <Link
                to={`/campaigns/${campaign.id}`}
                className="flex min-h-tap flex-col justify-center rounded-lg border border-edge bg-surface px-4 py-2 active:bg-surface-raised"
              >
                <span className="text-base font-semibold text-text">{campaign.name}</span>
                <span className="text-sm text-state-later">
                  {campaign.company ?? 'company not saved yet'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link
        to="/campaigns/new"
        className="flex min-h-tap items-center rounded-lg border border-edge bg-surface px-4 text-base font-semibold text-text active:bg-surface-raised"
      >
        + New campaign
      </Link>
    </section>
  )
}
