import { Link } from 'react-router-dom'

import { ChevronRightIcon } from '../components/icons'
import { ScreenHeader, SectionLabel } from '../components/ui'
import type { Campaign, CampaignAccount } from '../data'
import { canPostFrom } from '../data'
import { useData } from '../data/useData'
import { useLoaded } from '../data/useLoaded'
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
  const [loaded] = useLoaded(async () => {
    const [campaigns, accounts] = await Promise.all([
      data.listCampaigns(),
      data.listCampaignAccounts(),
    ])
    return { campaigns, accounts }
  }, [data])

  if (loaded === null) return null
  const { campaigns, accounts } = loaded

  const live = campaigns.filter((campaign) => campaignIsLive(campaign, accounts))
  const totals = totalEarnings(live, accounts)
  const unrated = campaignsWithoutRate(live, accounts)

  // Everything onboarding is holding back. listCampaigns already drops the
  // archived ones, so this is only campaigns he is actually trying to run.
  const blocked = campaigns.filter((campaign) => !campaignIsLive(campaign, accounts))
  const couldBe = totalEarnings(blocked, accounts)
  const heldBack = couldBe.monthCents > 0

  // Each campaign's month as a share of the best-paying one, for the thin
  // bar under it. Neutral, never a state colour: it says how big, not how
  // good or bad.
  const months = campaigns.map((campaign) => monthlyPayCents(campaign, accounts) ?? 0)
  const biggest = Math.max(1, ...months)

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-7">
      <ScreenHeader title="Money" meta="What you earn from campaigns with a ready account." />

      {/* One hero - the day, which is the unit he works in - and the week
          and month beside each other under it. What each period would come
          to once onboarding is done sits under its own figure: the finished
          number rather than the gap - "if i make 100, could make +100, then
          put could make 200". */}
      <div className="flex flex-col border-y border-rule">
        <div className="py-5">
          <Figure label="Per day" cents={totals.dayCents} size="hero" />
          {heldBack ? <CouldMake cents={totals.dayCents + couldBe.dayCents} /> : null}
        </div>
        <div className="grid grid-cols-2 divide-x divide-rule border-t border-rule">
          <div className="py-4 pr-4">
            <Figure label="Per week" cents={totals.weekCents} size="md" />
            {heldBack ? <CouldMake cents={totals.weekCents + couldBe.weekCents} /> : null}
          </div>
          <div className="py-4 pl-4">
            <Figure label="Per month" cents={totals.monthCents} size="md" />
            {heldBack ? <CouldMake cents={totals.monthCents + couldBe.monthCents} /> : null}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>By campaign</SectionLabel>
        <ul className="flex flex-col divide-y divide-rule">
          {byBestPay(campaigns, accounts).map((campaign) => (
            <li key={campaign.id}>
              <CampaignLine
                campaign={campaign}
                counting={campaignIsLive(campaign, accounts)}
                accounts={accounts}
                share={(monthlyPayCents(campaign, accounts) ?? 0) / biggest}
              />
            </li>
          ))}
        </ul>
      </div>

      {unrated.length > 0 ? (
        <p className="meta text-state-later">
          {unrated.length === 1 ? 'One campaign has' : `${unrated.length} campaigns have`} no rate
          saved, so {unrated.length === 1 ? 'it is' : 'they are'} not counted above - unknown, not
          zero. Add it on the brief.
        </p>
      ) : null}
    </section>
  )
}

function Figure({ label, cents, size }: { label: string; cents: number; size: 'hero' | 'md' }) {
  // Fluid rather than fixed, so the figure he came to read is never sliced
  // off at the edge of a narrow phone, and still reads large on a laptop.
  // Held to one line, so "~$1438.50 CAD" never strands its "CAD".
  return (
    <div className="min-w-0">
      <p className="label whitespace-nowrap text-state-later">{label}</p>
      <p
        className="numeric mt-2 whitespace-nowrap font-semibold leading-none text-text"
        style={{ fontSize: size === 'hero' ? 'clamp(3rem, 16vw, 4.25rem)' : 'clamp(1.375rem, 6.4vw, 1.875rem)' }}
      >
        {formatCents(cents)}
      </p>
      <p className="numeric meta mt-2 whitespace-nowrap text-state-later">~{formatCents(toCadCents(cents))} CAD</p>
    </div>
  )
}

/** What this period comes to with every campaign running. */
function CouldMake({ cents }: { cents: number }) {
  return (
    <p className="mt-3 flex items-baseline gap-2 leading-tight">
      <span className="label text-state-later">Could make</span>
      <span className="numeric text-base font-semibold text-text-dim">{formatCents(cents)}</span>
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
  share,
}: {
  campaign: Campaign
  counting: boolean
  accounts: readonly CampaignAccount[]
  /** This campaign's month against the best-paying one, 0 to 1. */
  share: number
}) {
  const earnings = campaignEarnings(campaign, accounts)
  const monthly = monthlyPayCents(campaign, accounts)
  const mine = hasMonthlyOverride(campaign)
  const platforms = payingPlatforms(campaign, accounts)

  return (
    <Link
      to={`/campaigns/${campaign.id}`}
      className="press flex min-h-tap items-center gap-3 py-3.5 active:bg-surface"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className={`min-w-0 flex-1 truncate text-base font-semibold ${counting ? 'text-text' : 'text-state-later'}`}>
            {campaign.name}
          </span>
          <span
            className={`numeric shrink-0 whitespace-nowrap text-right text-base font-semibold ${
              counting ? 'text-text' : 'text-state-later line-through'
            }`}
          >
            {earnings === null ? '-' : `${mine ? '' : '~'}${formatCents(earnings.monthCents)}/mo`}
          </span>
        </span>

        {/* The workings on their own line. Beside the name and the total they
            ran past the edge of the row once the text was made bigger. */}
        <span className="numeric meta text-state-later">
          {campaign.pay_per_video_cents === null
            ? mine
              ? 'your figure'
              : 'no rate saved'
            : `${formatCents(campaign.pay_per_video_cents)} x ${campaign.daily_post_quota}/day${
                platforms > 1 ? ` x ${platforms}` : ''
              }`}
        </span>

        <span aria-hidden className="mt-1 h-px w-full bg-rule">
          <span
            className={`block h-px ${counting ? 'bg-text-dim' : 'bg-state-later/50'}`}
            style={{ width: `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%` }}
          />
        </span>

        {/* One line on the campaign holding it up, saying what finishing
            onboarding is worth. Grey, not amber: nothing here is wrong or
            overdue, it is simply not switched on yet. */}
        {!counting && monthly !== null ? (
          <span className="meta text-state-later">
            +{formatCents(monthly)}/mo once an account is ready · {blockerLabel(campaign, accounts)}
          </span>
        ) : null}
      </span>
      <ChevronRightIcon className="h-5 w-5 shrink-0 text-state-later" />
    </Link>
  )
}
