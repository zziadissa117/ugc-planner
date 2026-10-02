import { useState } from 'react'
import { Link } from 'react-router-dom'

import { ChevronRightIcon } from '../components/icons'
import { ScreenHeader, SectionLabel, StateDot } from '../components/ui'
import { EARNINGS_HISTORY_START, liveCheckoffs, netCents, totalsBy, type Period } from '../data/earnings'
import { formatDay, formatMonth } from '../data/payouts'
import { useData } from '../data/useData'
import { useLoaded } from '../data/useLoaded'
import { formatCents, toCadCents } from '../money'

const PERIODS: { id: Period; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
]

function labelFor(key: string, period: Period): string {
  if (period === 'month') return formatMonth(key)
  if (period === 'week') return `Week of ${formatDay(key)}`
  return formatDay(key)
}

/** The money he has actually made, from the append-only earnings history.
 *
 *  Every figure here is a sum of rows that were written when a box was ticked
 *  or un-ticked and never changed afterwards, so a number he read yesterday is
 *  the number it still is today. Taking a post back appears as its own line
 *  rather than as the original quietly vanishing. */
export function EarningsHistory() {
  const data = useData()
  const [period, setPeriod] = useState<Period>('day')

  const [loaded] = useLoaded(async () => {
    const [events, campaigns, accounts, posts] = await Promise.all([
      data.listEarningsEvents(),
      data.listCampaigns({ includeInactive: true }),
      data.listCampaignAccounts(),
      data.listAllVideoPosts(),
    ])
    return { events, campaigns, accounts, posts }
  }, [data])

  if (loaded === null) return null
  const { events, campaigns, accounts, posts } = loaded

  const nameOf = new Map(campaigns.map((c) => [c.id, c.name]))
  const totals = totalsBy(events, period)
  const total = netCents(events)
  const recent = [...events].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, 40)

  // Ticks since the history began that earned nothing recorded: no rate was
  // saved when they went out. Said out loud, because a total that quietly
  // leaves them out would read as the whole story.
  const bonusOnly = new Set(accounts.filter((a) => a.bonus_only).map((a) => a.id))
  const counted = new Set(liveCheckoffs(events).map((e) => `${e.video_id}:${e.account_id}`))
  const unpriced = posts.filter(
    (p) =>
      p.account_id !== null &&
      !bonusOnly.has(p.account_id) &&
      p.posted_at.slice(0, 10) >= EARNINGS_HISTORY_START &&
      !counted.has(`${p.video_id}:${p.account_id}`),
  ).length

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-7">
      <ScreenHeader
        title="Earnings"
        meta={`Money made from what you ticked off, since ${formatDay(EARNINGS_HISTORY_START)}, 2026.`}
        aside={
          <Link to="/money" className="press flex items-center gap-1 label text-state-later">
            Money
            <ChevronRightIcon className="h-4 w-4" />
          </Link>
        }
      />

      <div className="border-y border-rule py-5">
        <p className="label whitespace-nowrap text-state-later">Total so far</p>
        <p
          className="numeric mt-2 whitespace-nowrap font-semibold leading-none text-text"
          style={{ fontSize: 'clamp(3rem, 16vw, 4.25rem)' }}
        >
          {formatCents(total)}
        </p>
        <p className="numeric meta mt-2 whitespace-nowrap text-state-later">
          ~{formatCents(toCadCents(total))} CAD
        </p>
      </div>

      {unpriced > 0 ? (
        <p className="border-l-2 border-state-waiting pl-3 text-base text-state-waiting">
          {unpriced} {unpriced === 1 ? 'post was' : 'posts were'} ticked with no rate saved, so
          {unpriced === 1 ? ' it is' : ' they are'} not counted. Unknown, not zero.
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <SectionLabel
          trailing={
            <span role="group" aria-label="Group by" className="flex items-center gap-1">
              {PERIODS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={period === id}
                  onClick={() => setPeriod(id)}
                  className={[
                    'press rounded-full px-2.5 py-1 label',
                    period === id ? 'bg-surface-raised text-state-now' : 'text-state-later active:bg-surface',
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </span>
          }
        >
          By {period}
        </SectionLabel>

        {totals.length === 0 ? (
          <p className="py-2 text-base text-text-dim">
            Nothing yet. Tick a post on a campaign with a rate and it lands here.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-rule">
            {totals.map(({ key, cents }) => (
              <li key={key} className="flex min-h-tap items-baseline justify-between gap-3 py-3">
                <span className="text-base text-text">{labelFor(key, period)}</span>
                <span
                  className={`numeric text-base font-semibold ${cents < 0 ? 'text-state-waiting' : 'text-text'}`}
                >
                  {formatCents(cents)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {recent.length > 0 ? (
        <div className="flex flex-col gap-2">
          <SectionLabel>Every entry</SectionLabel>
          <ul className="flex flex-col divide-y divide-rule">
            {recent.map((event) => {
              const back = event.source === 'reversal'
              return (
                <li key={event.id} className="flex min-h-tap items-center gap-3 py-2.5">
                  <StateDot tone={back ? 'waiting' : 'posted'} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base text-text">
                      {nameOf.get(event.campaign_id) ?? 'Removed campaign'} · {event.platform}
                    </span>
                    <span className="meta block text-state-later">
                      {formatDay(event.earned_on)} · {back ? 'taken back' : 'ticked off'}
                    </span>
                  </span>
                  <span
                    className={`numeric shrink-0 text-base font-semibold ${
                      back ? 'text-state-waiting' : 'text-text'
                    }`}
                  >
                    {back ? '-' : '+'}
                    {formatCents(Math.abs(event.amount_cents))}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
