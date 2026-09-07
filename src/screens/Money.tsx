import { useCallback, useEffect, useState } from 'react'

import type { Campaign, Video } from '../data'
import { useData } from '../data/useData'
import {
  summariseCampaignMoney,
  summariseCampaignPeriodEarnings,
  toCadCents,
  totalPeriodEarnings,
  type PeriodEarnings,
} from '../money'
import { formatCents } from '../session'

/** Three numbers, meant to be looked at: what today paid, what this week has
 *  paid, what this month has paid. He asked directly for this in place of the
 *  cycle tracking and the opening balance - "just track how much it pays by
 *  day, week, month to motivate me" - so this screen no longer tries to be a
 *  ledger. It still refuses to invent one thing: a posted video with no rate
 *  snapshot is flagged, not counted as zero. */
export function Money() {
  const data = useData()
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [videos, setVideos] = useState<Video[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [nextCampaigns, nextVideos] = await Promise.all([data.listCampaigns(), data.listVideos()])
    setCampaigns(nextCampaigns)
    setVideos(nextVideos)
  }, [data])

  useEffect(() => {
    void load()
  }, [load])

  const backfill = useCallback(
    async (campaign: Campaign) => {
      setBusy(true)
      try {
        await data.backfillUnpricedVideos(campaign.id)
        await load()
      } finally {
        setBusy(false)
      }
    },
    [data, load],
  )

  if (campaigns === null) return null

  const totals = totalPeriodEarnings(campaigns, videos)
  const unpricedTotal = campaigns.reduce(
    (sum, c) => sum + summariseCampaignMoney(c, videos, [], []).unpricedPostedCount,
    0,
  )

  return (
    <section className="mx-auto flex max-w-screen-sm flex-col gap-8">
      <h1 className="text-2xl font-semibold text-text">Money</h1>

      <div className="grid grid-cols-3 gap-3">
        <Period label="Today" cents={totals.todayCents} />
        <Period label="This week" cents={totals.weekCents} />
        <Period label="This month" cents={totals.monthCents} />
      </div>

      {unpricedTotal > 0 ? (
        <p className="text-sm text-state-waiting">
          {unpricedTotal} posted {unpricedTotal === 1 ? 'video has' : 'videos have'} no rate saved.
          They are not counted above - their pay is unknown, not zero.
        </p>
      ) : null}

      {campaigns.map((campaign) => (
        <CampaignSection
          key={campaign.id}
          campaign={campaign}
          videos={videos}
          busy={busy}
          onBackfill={() => void backfill(campaign)}
        />
      ))}
    </section>
  )
}

function Period({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="rounded-lg border border-edge bg-surface p-3 text-center">
      <p className="text-xs font-semibold uppercase tracking-wide text-state-later">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-text">{formatCents(cents)}</p>
      <p className="mt-1 text-xs tabular-nums text-state-later">
        ~{formatCents(toCadCents(cents))} CAD
      </p>
    </div>
  )
}

function CampaignSection({
  campaign,
  videos,
  busy,
  onBackfill,
}: {
  campaign: Campaign
  videos: Video[]
  busy: boolean
  onBackfill: () => void
}) {
  const period: PeriodEarnings = summariseCampaignPeriodEarnings(campaign, videos)
  const money = summariseCampaignMoney(campaign, videos, [], [])

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-text">{campaign.name}</h2>

      <dl className="grid grid-cols-3 gap-3 text-sm">
        <Line label="Today">{formatCents(period.todayCents)}</Line>
        <Line label="This week">{formatCents(period.weekCents)}</Line>
        <Line label="This month">{formatCents(period.monthCents)}</Line>
      </dl>

      {money.unpricedPostedCount > 0 ? (
        <div className="rounded-lg border border-state-waiting/40 bg-state-waiting/10 p-4">
          <p className="text-state-waiting">
            {money.unpricedPostedCount} posted{' '}
            {money.unpricedPostedCount === 1 ? 'video was' : 'videos were'} made before this
            campaign had a rate saved.
          </p>
          {money.canBackfill ? (
            <button
              type="button"
              onClick={onBackfill}
              disabled={busy}
              className="mt-3 min-h-tap w-full rounded-lg border border-edge bg-surface px-4 font-semibold text-text active:bg-surface-raised disabled:text-state-later"
            >
              Apply {formatCents(campaign.pay_per_video_cents ?? 0)} to{' '}
              {money.unpricedPostedCount === 1 ? 'it' : 'them'}
            </button>
          ) : (
            <p className="mt-2 text-sm text-state-later">
              Save a rate for this campaign and they can be priced.
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-lg border border-edge bg-surface p-2 text-center">
      <dt className="text-xs text-state-later">{label}</dt>
      <dd className="tabular-nums text-text">{children}</dd>
    </div>
  )
}
