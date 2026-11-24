import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'

import { ChevronRightIcon, PlatformGlyph, PlusIcon } from '../components/icons'
import { CARD_CLASS, buttonClass } from '../components/styles'
import { ScreenHeader, SectionLabel } from '../components/ui'
import type { Campaign, CampaignAccount } from '../data'
import { hasAccountsAdded } from '../data/accountsAdded'
import { recordingGroups } from '../data/campaignOrder'
import { useData } from '../data/useData'
import { useLoaded } from '../data/useLoaded'
import { formatViews } from '../data/views'
import {
  byBestPay,
  campaignEarnings,
  campaignsWithoutRate,
  formatCents,
  totalEarnings,
} from '../money'

/** Every campaign, as tiles, in the order he records them.
 *
 *  "Campaigns that need high-quality videos come first - they are recorded
 *  first in a batch; quick and easy ones last." So the campaigns with a
 *  minimum number of views are one group at the top and the rest a group
 *  under it (src/data/campaignOrder.ts), each best-pay first. This is the
 *  Campaigns list only: the Post screen keeps the order he set by hand.
 *
 *  A tile holds the name, the platforms as logos, what it pays a day and -
 *  for a high-quality one - the minimum views. Everything else is one tap
 *  away on the campaign page.
 *
 *  The money sits at the bottom, small: what finishing every post pays a
 *  day, and what the signed contracts come to a month. It used to be a tab
 *  of its own. */
export function Campaigns() {
  const data = useData()
  const [loaded] = useLoaded(async () => {
    const [campaigns, accounts, archived] = await Promise.all([
      data.listCampaigns(),
      data.listCampaignAccounts(),
      data.listArchivedCampaigns(),
    ])
    return { campaigns, accounts, archived: archived.length }
  }, [data])
  const campaigns = loaded?.campaigns ?? null
  const accounts = loaded?.accounts ?? []
  const { highQuality, quick } = recordingGroups(byBestPay(campaigns ?? [], accounts))
  const archived = loaded?.archived ?? 0

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8">
      <ScreenHeader
        kicker="Campaigns"
        title="Your campaigns"
        aside={
          campaigns !== null && campaigns.length > 0 ? (
            <Link to="/campaigns/new" aria-label="New campaign" className={buttonClass('now', 'small')}>
              <PlusIcon className="h-4 w-4" />
              New
            </Link>
          ) : null
        }
      />

      {campaigns === null ? null : campaigns.length === 0 ? (
        <div className={`${CARD_CLASS} flex flex-col items-start gap-4 p-6`}>
          <p className="text-base text-text-dim">No campaigns yet.</p>
          <Link to="/campaigns/new" aria-label="New campaign" className={buttonClass('now')}>
            <PlusIcon className="h-5 w-5" />
            Add a campaign
          </Link>
        </div>
      ) : (
        <>
          {highQuality.length > 0 ? (
            <Group label="High quality - record first" campaigns={highQuality} accounts={accounts} />
          ) : null}
          {quick.length > 0 ? (
            <Group label="Quick and easy - last" campaigns={quick} accounts={accounts} offset={highQuality.length} />
          ) : null}
          <MoneySummary campaigns={campaigns} accounts={accounts} />
        </>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {campaigns !== null && campaigns.length === 0 ? (
          <Link to="/money/history" className="meta text-state-later underline underline-offset-4">
            Earnings history
          </Link>
        ) : null}
        {archived > 0 ? (
          <Link to="/campaigns/archived" className="meta text-state-later underline underline-offset-4">
            Archived ({archived})
          </Link>
        ) : null}
      </div>
    </section>
  )
}

function Group({
  label,
  campaigns,
  accounts,
  offset = 0,
}: {
  label: string
  campaigns: readonly Campaign[]
  accounts: readonly CampaignAccount[]
  /** How many tiles came before this group, so the stagger carries on. */
  offset?: number
}) {
  return (
    <div className="flex flex-col gap-3">
      <SectionLabel trailing={campaigns.length}>{label}</SectionLabel>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {campaigns.map((campaign, index) => (
          <li key={campaign.id} className="settle-in flex" style={{ '--i': offset + index } as CSSProperties}>
            <CampaignTile campaign={campaign} accounts={accounts} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** One campaign: name, platform logos, pay a day, and the minimum views when
 *  it has one.
 *
 *  The day is the same figure the campaign page shows - a seventh of the
 *  week, or a thirtieth of the month he corrected - so the two never
 *  disagree. No rate reads "not saved yet" rather than a number. */
function CampaignTile({
  campaign,
  accounts,
}: {
  campaign: Campaign
  accounts: readonly CampaignAccount[]
}) {
  const earnings = campaignEarnings(campaign, accounts)
  const platforms = accounts
    .filter((a) => a.campaign_id === campaign.id && a.is_active)
    .map((a) => ({ id: a.id, platform: a.platform }))

  return (
    <Link
      to={`/campaigns/${campaign.id}`}
      className={`${CARD_CLASS} press flex min-w-0 flex-1 flex-col gap-4 p-4 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-edge-lit`}
    >
      <div className="min-w-0">
        <h3 className="display break-words text-xl text-text md:text-2xl">{campaign.name}</h3>
        {platforms.length === 0 ? null : (
          // Logos only, wrapping freely: a glyph never sits in a slot sized
          // for a name.
          <p
            role="img"
            aria-label={platforms.map((p) => p.platform).join(', ')}
            className="mt-3 flex flex-wrap gap-3 text-text"
          >
            {platforms.map((p) => (
              <PlatformGlyph key={p.id} platform={p.platform} className="h-6 w-6" />
            ))}
          </p>
        )}
        {/* Red: nobody can post from this campaign yet. */}
        {hasAccountsAdded(accounts, campaign.id) ? null : (
          <p className="meta mt-3 font-semibold text-state-blocked">add your accounts</p>
        )}
      </div>

      <div className="mt-auto flex flex-col gap-3">
        <div>
          <p className="label text-state-later">per day</p>
          {earnings === null ? (
            <p className="mt-1 text-base text-state-later">not saved yet</p>
          ) : (
            <p className="numeric mt-1 text-[1.625rem] font-semibold leading-none text-text md:text-[1.875rem]">
              {formatCents(earnings.dayCents)}
            </p>
          )}
        </div>
        {campaign.min_views == null ? null : (
          <div>
            <p className="label text-state-later">min views</p>
            <p className="numeric mt-1 text-xl font-semibold leading-none text-text">
              {formatViews(campaign.min_views)}
            </p>
          </div>
        )}
      </div>
    </Link>
  )
}

/** What the campaigns pay, small, under the list.
 *
 *  Every active campaign, with the same rules as everywhere else (src/money.ts):
 *  a week is the deliverable's value x posts a week, a day a seventh of it,
 *  a month 30/7 of it - or his own month where he corrected one. A campaign
 *  with no rate is left out and named, because unknown is not zero. */
function MoneySummary({
  campaigns,
  accounts,
}: {
  campaigns: readonly Campaign[]
  accounts: readonly CampaignAccount[]
}) {
  const totals = totalEarnings(campaigns, accounts)
  const unrated = campaignsWithoutRate(campaigns, accounts)

  return (
    <div className="flex flex-col gap-3">
      <SectionLabel>Money</SectionLabel>
      <dl className="flex flex-col gap-2.5">
        <MoneyLine label="Finish all your posts" cents={totals.dayCents} per="a day" />
        <MoneyLine label="Signed contracts" cents={totals.monthCents} per="a month" />
      </dl>
      {unrated.length > 0 ? (
        <p className="meta text-state-later">
          {unrated.length === 1 ? `${unrated[0].name} has` : `${unrated.length} campaigns have`} no pay per video
          saved, so {unrated.length === 1 ? "it isn't" : "they aren't"} counted.
        </p>
      ) : null}
      <Link
        to="/money/history"
        className="press group flex items-center gap-1 self-start meta text-state-later transition-colors hover:text-text"
      >
        Earnings history
        <ChevronRightIcon className="h-4 w-4 text-brand transition-transform duration-200 group-hover:translate-x-0.5" />
      </Link>
    </div>
  )
}

function MoneyLine({ label, cents, per }: { label: string; cents: number; per: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="min-w-0 text-base text-text-dim">{label}</dt>
      <dd className="numeric shrink-0 whitespace-nowrap text-lg font-semibold text-text">
        {formatCents(cents)} <span className="text-sm font-normal text-state-later">{per}</span>
      </dd>
    </div>
  )
}
