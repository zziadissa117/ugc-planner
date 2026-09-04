import { useCallback, useEffect, useState } from 'react'

import type { Campaign } from '../data'
import { useData } from '../data/useData'
import { summariseAllMoney, totalMoney, type CampaignMoney } from '../money'
import { formatCents } from '../session'

/** SPEC section 10.
 *
 *  Three figures, laid out as three separate cards with three different
 *  labels, and no total anywhere. They mean genuinely different things -
 *  earned, guessed, and banked - and a single number combining them would be
 *  the most believable wrong figure the app could show. */
export function Money() {
  const data = useData()
  const [summaries, setSummaries] = useState<CampaignMoney[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [campaigns, videos, claims] = await Promise.all([
      data.listCampaigns(),
      data.listVideos(),
      data.listBonusClaims(),
    ])
    const tiers = (await Promise.all(campaigns.map((c) => data.listBonusTiers(c.id)))).flat()
    return summariseAllMoney(campaigns, videos, tiers, claims)
  }, [data])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const next = await load()
      if (!cancelled) setSummaries(next)
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  const backfill = useCallback(
    async (campaign: Campaign) => {
      setBusy(true)
      try {
        await data.backfillUnpricedVideos(campaign.id)
        setSummaries(await load())
      } finally {
        setBusy(false)
      }
    },
    [data, load],
  )

  if (summaries === null) return null
  const totals = totalMoney(summaries)

  return (
    <section className="mx-auto flex max-w-screen-sm flex-col gap-8">
      <h1 className="text-2xl font-semibold text-text">Money</h1>

      <div className="flex flex-col gap-3">
        <Figure
          label="Documented"
          note="Posted videos at the rate each one locked in at."
          cents={totals.documentedCents}
        />
        <Figure
          label="Expected"
          note="Bonus payouts times the odds you gave them. Not earned."
          cents={totals.expectedBonusCents}
          muted={totals.expectedBonusCents === 0}
          zeroNote="No odds set yet, so this stays $0.00 until you judge one."
        />
        <Figure
          label="User entered"
          note="Bonus money you logged as actually received."
          cents={totals.receivedBonusCents}
        />
      </div>

      {totals.unpricedPostedCount > 0 ? (
        <p className="text-sm text-state-waiting">
          {totals.unpricedPostedCount} posted{' '}
          {totals.unpricedPostedCount === 1 ? 'video has' : 'videos have'} no rate saved. They are
          not counted above - their pay is unknown, not zero.
        </p>
      ) : null}

      {summaries.map((summary) => (
        <CampaignSection
          key={summary.campaign.id}
          summary={summary}
          busy={busy}
          onBackfill={() => void backfill(summary.campaign)}
        />
      ))}
    </section>
  )
}

function Figure({
  label,
  note,
  cents,
  muted,
  zeroNote,
}: {
  label: string
  note: string
  cents: number
  muted?: boolean
  zeroNote?: string
}) {
  return (
    <div className="rounded-lg border border-edge bg-surface p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-state-later">{label}</p>
      <p
        className={`mt-1 text-3xl font-semibold tabular-nums ${muted ? 'text-state-later' : 'text-text'}`}
      >
        {formatCents(cents)}
      </p>
      <p className="mt-1 text-sm text-state-later">{note}</p>
      {muted && zeroNote ? <p className="mt-1 text-sm text-state-later">{zeroNote}</p> : null}
    </div>
  )
}

function CampaignSection({
  summary,
  busy,
  onBackfill,
}: {
  summary: CampaignMoney
  busy: boolean
  onBackfill: () => void
}) {
  const { campaign } = summary

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-text">{campaign.name}</h2>

      {summary.cycleSize === null ? null : (
        <div>
          <p className="tabular-nums text-text">
            {summary.postsIntoCurrentCycle} of {summary.cycleSize} this cycle
          </p>
          <div
            role="progressbar"
            aria-valuenow={summary.postsIntoCurrentCycle}
            aria-valuemin={0}
            aria-valuemax={summary.cycleSize}
            className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-raised"
          >
            <div
              className="h-full bg-state-posted"
              style={{ width: `${(summary.postsIntoCurrentCycle / summary.cycleSize) * 100}%` }}
            />
          </div>
          {/* Accrued, not payable. Nothing is owed until a cycle closes. */}
          <p className="mt-2 text-sm text-state-waiting">
            {summary.isPayable
              ? `${summary.completedCycles} ${summary.completedCycles === 1 ? 'cycle has' : 'cycles have'} completed. Everything since is accrued, not payable yet.`
              : `${formatCents(summary.documentedCents)} accrued. Not payable until this cycle closes.`}
          </p>
        </div>
      )}

      <dl className="flex flex-col gap-2 text-sm">
        <Line label="Posted in this app">
          {summary.postedInAppCount} · {formatCents(summary.documentedCents)} documented
        </Line>

        {/* Its own line, never folded into the posted-video maths. These posts
            happened before the app existed and no rate was ever recorded for
            them, so they count toward the cycle and carry no money. */}
        <Line label="Opening balance">
          {summary.openingPostCount} posts carried over - counted toward the cycle, with no
          recorded earnings
        </Line>

        <Line label="Cycle position">
          {summary.cyclePosition}
          {summary.cycleSize === null ? '' : ` of ${summary.cycleSize}`}
        </Line>
      </dl>

      {summary.unpricedPostedCount > 0 ? (
        <div className="rounded-lg border border-state-waiting/40 bg-state-waiting/10 p-4">
          <p className="text-state-waiting">
            {summary.unpricedPostedCount} posted{' '}
            {summary.unpricedPostedCount === 1 ? 'video was' : 'videos were'} made before this
            campaign had a rate saved.
          </p>
          {summary.canBackfill ? (
            <button
              type="button"
              onClick={onBackfill}
              disabled={busy}
              className="mt-3 min-h-tap w-full rounded-lg border border-edge bg-surface px-4 font-semibold text-text active:bg-surface-raised disabled:text-state-later"
            >
              Apply {formatCents(campaign.pay_per_video_cents ?? 0)} to{' '}
              {summary.unpricedPostedCount === 1 ? 'it' : 'them'}
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
    <div className="flex flex-col">
      <dt className="text-state-later">{label}</dt>
      <dd className="text-text">{children}</dd>
    </div>
  )
}
