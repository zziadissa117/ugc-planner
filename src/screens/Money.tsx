import { useCallback, useEffect, useState } from 'react'

import type { Campaign } from '../data'
import { useData } from '../data/useData'
import {
  OPENING_BALANCE_RATE_KEY,
  summariseAllMoney,
  totalMoney,
  type CampaignMoney,
} from '../money'
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
    const [tiers, fields] = await Promise.all([
      Promise.all(campaigns.map((c) => data.listBonusTiers(c.id))).then((r) => r.flat()),
      Promise.all(campaigns.map((c) => data.listCampaignFields(c.id))).then((r) => r.flat()),
    ])
    return summariseAllMoney(campaigns, videos, tiers, claims, fields)
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

  const saveOpeningRate = useCallback(
    async (campaign: Campaign, cents: number) => {
      setBusy(true)
      try {
        await data.setCampaignField({
          campaign_id: campaign.id,
          field_key: OPENING_BALANCE_RATE_KEY,
          field_value: String(cents),
          // His own figure, with no document behind it. Confirming it below
          // leaves it user_entered rather than promoting it to documented.
          source: 'user_entered',
          source_quote: null,
          source_document_id: null,
        })
        await data.confirmCampaignField(campaign.id, OPENING_BALANCE_RATE_KEY)
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
        >
          {/* Its own line inside the card, never added to the figure above.
              The per-video total is built from rates this app watched being
              locked in; this is his recollection of what happened before it
              existed. Both are honest, and they are not the same kind. */}
          {summaries
            .filter((s) => s.openingBalanceCents !== null)
            .map((s) => (
              <p key={s.campaign.id} className="mt-2 border-t border-edge pt-2 text-sm">
                <span className="text-state-later">
                  {s.campaign.name} - {s.openingPostCount} posts carried over at{' '}
                  {formatCents(s.openingBalanceRateCents ?? 0)}:{' '}
                </span>
                <span className="tabular-nums text-text">
                  {formatCents(s.openingBalanceCents ?? 0)}
                </span>
              </p>
            ))}
        </Figure>
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
          onSaveOpeningRate={(campaign, cents) => void saveOpeningRate(campaign, cents)}
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
  children,
}: {
  label: string
  note: string
  cents: number
  muted?: boolean
  zeroNote?: string
  children?: React.ReactNode
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
      {children}
    </div>
  )
}

function CampaignSection({
  summary,
  busy,
  onBackfill,
  onSaveOpeningRate,
}: {
  summary: CampaignMoney
  busy: boolean
  onBackfill: () => void
  onSaveOpeningRate: (campaign: Campaign, cents: number) => void
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
          {summary.postedInAppCount} Â· {formatCents(summary.documentedCents)} documented
        </Line>

        {/* Its own line, never folded into the posted-video maths. */}
        <Line label="Opening balance">
          {summary.openingBalanceCents === null
            ? `${summary.openingPostCount} posts carried over - counted toward the cycle, with no recorded earnings`
            : `${summary.openingPostCount} posts carried over at ${formatCents(summary.openingBalanceRateCents ?? 0)} each`}
        </Line>

        <Line label="Cycle position">
          {summary.cyclePosition}
          {summary.cycleSize === null ? '' : ` of ${summary.cycleSize}`}
        </Line>
      </dl>

      {summary.openingPostCount > 0 && summary.openingBalanceCents === null ? (
        <OpeningRateAsk summary={summary} onSave={onSaveOpeningRate} busy={busy} />
      ) : null}

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

/** Asks what the carried-over posts were paid at.
 *
 *  The app cannot work this out. Today's rate is a fact about today, and the
 *  posts predate everything it has ever seen. But being unable to derive it is
 *  not a reason to stay quiet about it - he knows, and nobody has asked. */
function OpeningRateAsk({
  summary,
  onSave,
  busy,
}: {
  summary: CampaignMoney
  onSave: (campaign: Campaign, cents: number) => void
  busy: boolean
}) {
  const [dollars, setDollars] = useState('')
  const cents = Math.round(Number(dollars) * 100)
  const valid = dollars.trim() !== '' && Number.isFinite(cents) && cents >= 0

  return (
    <div className="rounded-lg border border-edge bg-surface p-4">
      <label
        htmlFor={`opening-rate-${summary.campaign.id}`}
        className="text-sm text-state-later"
      >
        What were those {summary.openingPostCount} carried-over posts paid at? Nothing here
        records it, and it is not assumed to be the current rate.
      </label>
      <div className="mt-3 flex gap-3">
        <input
          id={`opening-rate-${summary.campaign.id}`}
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={dollars}
          onChange={(event) => setDollars(event.target.value)}
          placeholder="35.00"
          className="min-h-tap flex-1 rounded-lg border border-edge bg-ink px-4 text-text placeholder:text-state-later"
        />
        <button
          type="button"
          disabled={!valid || busy}
          onClick={() => onSave(summary.campaign, cents)}
          className="min-h-tap rounded-lg border border-edge bg-surface px-5 font-semibold text-text active:bg-surface-raised disabled:text-state-later"
        >
          Save
        </button>
      </div>
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
