import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import type { Campaign } from '../data'
import { useData } from '../data/useData'
import {
  campaignEarnings,
  campaignsWithoutRate,
  formatCents,
  toCadCents,
  totalEarnings,
} from '../money'

/** What the work pays, from one formula: rate x posts per day.
 *
 *  Nothing on this screen counts videos, posts or platforms. That is the
 *  point: every wrong figure this screen has ever shown came from counting
 *  something - a backlog cleared in one sitting, an account list mistaken for
 *  a quota - rather than reading the campaign's own two numbers. */
export function Money() {
  const data = useData()
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)

  const load = useCallback(async () => {
    setCampaigns(await data.listCampaigns())
  }, [data])

  useEffect(() => {
    void load()
  }, [load])

  if (campaigns === null) return null

  const totals = totalEarnings(campaigns)
  const unrated = campaignsWithoutRate(campaigns)

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold text-text">Money</h1>
        <p className="text-sm text-state-later">
          What you earn at your current rates and daily posts.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-2">
        <Figure label="Per day" cents={totals.dayCents} big />
        <Figure label="Per week" cents={totals.weekCents} />
        <Figure label="Per month" cents={totals.monthCents} />
      </div>

      <ul className="flex flex-col gap-1.5">
        {campaigns.map((campaign) => (
          <li key={campaign.id}>
            <CampaignLine campaign={campaign} />
          </li>
        ))}
      </ul>

      {unrated.length > 0 ? (
        <p className="text-sm text-state-waiting">
          {unrated.length === 1 ? 'One campaign has' : `${unrated.length} campaigns have`} no rate
          saved, so {unrated.length === 1 ? 'it is' : 'they are'} not counted above - unknown, not
          zero. Add it on the brief.
        </p>
      ) : null}
    </section>
  )
}

function Figure({ label, cents, big }: { label: string; cents: number; big?: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-edge bg-gradient-to-b from-surface-raised to-surface p-3 text-center">
      <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-edge-lit/70" />
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-state-later">
        {label}
      </p>
      <p className={`numeric mt-1 font-semibold text-text ${big ? 'text-3xl' : 'text-xl'}`}>
        {formatCents(cents)}
      </p>
      <p className="numeric mt-0.5 text-[11px] text-state-later">
        ~{formatCents(toCadCents(cents))} CAD
      </p>
    </div>
  )
}

function CampaignLine({ campaign }: { campaign: Campaign }) {
  const earnings = campaignEarnings(campaign)

  return (
    <Link
      to={`/campaigns/${campaign.id}`}
      className="flex min-h-tap items-center justify-between gap-3 rounded-lg border border-edge bg-surface px-3 py-2 active:bg-surface-raised"
    >
      <span className="min-w-0 flex-1 truncate text-sm text-text">{campaign.name}</span>
      <span className="shrink-0 text-sm tabular-nums text-state-later">
        {campaign.pay_per_video_cents === null
          ? 'no rate saved'
          : `${formatCents(campaign.pay_per_video_cents)} x ${campaign.daily_post_quota}/day`}
      </span>
      <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums text-text">
        {earnings === null ? '-' : `${formatCents(earnings.dayCents)}`}
      </span>
    </Link>
  )
}
