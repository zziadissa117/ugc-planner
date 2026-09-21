import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import type { Campaign, CampaignAccount } from '../data'
import { canPostFrom } from '../data'
import { useData } from '../data/useData'
import {
  byBestPay,
  campaignEarnings,
  campaignIsLive,
  campaignsWithoutRate,
  formatCents,
  hasMonthlyOverride,
  monthlyPayCents,
  payingPlatforms,
  toCadCents,
  totalEarnings,
} from '../money'

/** What the work pays, from one formula: rate x posts per day, or his own
 *  monthly figure where he has corrected it.
 *
 *  Nothing on this screen counts videos, posts or platforms. That is the
 *  point: every wrong figure this screen has ever shown came from counting
 *  something - a backlog cleared in one sitting, an account list mistaken for
 *  a quota - rather than reading the campaign's own numbers.
 *
 *  The account list is read for exactly one thing: whether a campaign counts
 *  at all. An account he has not marked ready is one he must not post from, so
 *  a campaign with no ready account is not earning yet and is kept out of the
 *  total. None of that money disappears: COULD MAKE under each period is what
 *  he is on now PLUS what is held back - the finished number, not the gap. */
export function Money() {
  const data = useData()
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [accounts, setAccounts] = useState<CampaignAccount[]>([])

  const load = useCallback(async () => {
    const [rows, theirAccounts] = await Promise.all([
      data.listCampaigns(),
      data.listCampaignAccounts(),
    ])
    setCampaigns(rows)
    setAccounts(theirAccounts)
  }, [data])

  useEffect(() => {
    void load()
  }, [load])

  if (campaigns === null) return null

  const live = campaigns.filter((campaign) => campaignIsLive(campaign, accounts))
  const totals = totalEarnings(live, accounts)
  const unrated = campaignsWithoutRate(live, accounts)

  // Everything onboarding is holding back. listCampaigns already drops the
  // archived ones, so this is only campaigns he is actually trying to run.
  const blocked = campaigns.filter((campaign) => !campaignIsLive(campaign, accounts))
  const couldBe = totalEarnings(blocked, accounts)
  const heldBack = couldBe.monthCents > 0

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-4">
      <header>
        <h1 className="text-xl font-semibold text-text">Money</h1>
        <p className="text-sm text-state-later">
          What you earn from campaigns with a ready account.
        </p>
      </header>

      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-3 gap-2">
          <Figure label="Per day" cents={totals.dayCents} big />
          <Figure label="Per week" cents={totals.weekCents} />
          <Figure label="Per month" cents={totals.monthCents} />
        </div>

        {/* Outside the cards, lined up under them: what each period would come
            to once onboarding is done. The full figure rather than the gap -
            "if i make 100, could make +100, then put could make 200" - because
            the number he wants to look at is the finished one. */}
        {heldBack ? (
          <div className="grid grid-cols-3 gap-2">
            <CouldMake cents={totals.dayCents + couldBe.dayCents} />
            <CouldMake cents={totals.weekCents + couldBe.weekCents} />
            <CouldMake cents={totals.monthCents + couldBe.monthCents} />
          </div>
        ) : null}
      </div>

      <ul className="flex flex-col gap-1.5">
        {byBestPay(campaigns, accounts).map((campaign) => (
          <li key={campaign.id}>
            <CampaignLine
              campaign={campaign}
              counting={campaignIsLive(campaign, accounts)}
              accounts={accounts}
            />
          </li>
        ))}
      </ul>

      {unrated.length > 0 ? (
        <p className="text-sm text-state-later">
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
    <div className="relative overflow-hidden rounded-2xl border border-edge bg-gradient-to-b from-surface-raised to-surface p-2 text-center sm:p-3">
      <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-edge-lit/70" />
      <p className="label whitespace-nowrap text-state-later">
        {label}
      </p>
      {/* Fluid rather than fixed: at `text-3xl` in a third of a 375px screen,
          "$35.00" ran past the card's edge and the last digit was sliced off -
          the one number on this screen he actually came to read. It scales
          with the viewport now, so it stays whole on a phone and still reads
          large on a laptop. */}
      <p
        className="numeric mt-1 font-semibold text-text"
        style={{
          fontSize: big
            ? 'clamp(1.25rem, 6.2vw, 1.875rem)'
            : 'clamp(1rem, 4.6vw, 1.25rem)',
        }}
      >
        {formatCents(cents)}
      </p>
      {/* Also fluid, and held to one line: at a fixed size "~$1438.50 CAD"
          wrapped and left "CAD" stranded on a line of its own. */}
      <p
        className="numeric mt-0.5 whitespace-nowrap text-state-later"
        style={{ fontSize: 'clamp(0.75rem, 3vw, 0.9375rem)' }}
      >
        ~{formatCents(toCadCents(cents))} CAD
      </p>
    </div>
  )
}

/** What this period comes to with every campaign running. */
function CouldMake({ cents }: { cents: number }) {
  return (
    <p className="text-center leading-tight">
      <span className="block label text-state-later">
        Could make
      </span>
      <span className="numeric block text-sm font-semibold text-text">{formatCents(cents)}</span>
    </p>
  )
}

/** What is standing between this campaign and the total.
 *
 *  Counted off the accounts that are switched on, using the same readiness the
 *  Post tab uses. He agreed to this line only if it is accurate, so it names
 *  the real statuses rather than saying "not ready" over whatever is there. */
function blockerLabel(campaign: Campaign, accounts: readonly CampaignAccount[]): string {
  const switchedOn = accounts.filter(
    (account) => account.campaign_id === campaign.id && account.is_active,
  )
  if (switchedOn.length === 0) return 'no accounts switched on'

  const waiting = switchedOn.filter((account) => !canPostFrom(account))
  const isNew = waiting.filter((account) => account.status === 'new').length
  const warming = waiting.filter((account) => account.status === 'warming').length

  if (warming === 0) return `${isNew} account${isNew === 1 ? '' : 's'} still New`
  if (isNew === 0) return `${warming} account${warming === 1 ? '' : 's'} Warming`
  return `${isNew} New, ${warming} Warming`
}

function CampaignLine({
  campaign,
  counting,
  accounts,
}: {
  campaign: Campaign
  counting: boolean
  accounts: readonly CampaignAccount[]
}) {
  const earnings = campaignEarnings(campaign, accounts)
  const monthly = monthlyPayCents(campaign, accounts)
  const mine = hasMonthlyOverride(campaign)
  const platforms = payingPlatforms(campaign, accounts)

  return (
    <Link
      to={`/campaigns/${campaign.id}`}
      className="flex min-h-tap flex-col justify-center gap-0.5 rounded-lg border border-edge bg-surface px-3 py-2 active:bg-surface-raised"
    >
      <span className="flex items-center justify-between gap-3">
        <span
          className={`min-w-0 flex-1 truncate text-sm ${counting ? 'text-text' : 'text-state-later'}`}
        >
          {campaign.name}
        </span>
        <span
          className={`shrink-0 whitespace-nowrap text-right text-sm font-semibold tabular-nums ${
            counting ? 'text-text' : 'text-state-later line-through'
          }`}
        >
          {earnings === null ? '-' : `${mine ? '' : '~'}${formatCents(earnings.monthCents)}/mo`}
        </span>
      </span>

      {/* The workings on their own line. Beside the name and the total they
          ran past the edge of the card once the text was made bigger. */}
      <span className="text-xs tabular-nums text-state-later">
        {campaign.pay_per_video_cents === null
          ? mine
            ? 'your figure'
            : 'no rate saved'
          : `${formatCents(campaign.pay_per_video_cents)} x ${campaign.daily_post_quota}/day${
              platforms > 1 ? ` x ${platforms}` : ''
            }`}
      </span>

      {/* One line on the campaign holding it up, saying what finishing
          onboarding is worth. Grey, not amber: nothing here is wrong or
          overdue, it is simply not switched on yet. */}
      {!counting && monthly !== null ? (
        <span className="text-xs text-state-later">
          +{formatCents(monthly)}/mo once an account is ready · {blockerLabel(campaign, accounts)}
        </span>
      ) : null}
    </Link>
  )
}
