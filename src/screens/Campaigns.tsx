import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'

import { PlatformGlyph, PlusIcon } from '../components/icons'
import { ScreenHeader } from '../components/ui'
import { buttonClass } from '../components/styles'
import type { Campaign, CampaignAccount } from '../data'
import { useData } from '../data/useData'
import { useLoaded } from '../data/useLoaded'
import { formatViews } from '../data/views'
import { byBestPay, campaignEarnings, formatCents } from '../money'

/** Every campaign at once, as a wall of tiles.
 *
 *  "The only things I need to know are: the name of the campaign, how much it
 *  pays per day, the minimum views, which accounts it posts to - only the
 *  logos." So a tile holds exactly those four and nothing else: no month, no
 *  week, no per-video rate, no handles. Everything else is one tap away on
 *  the campaign page, which is also where the month is corrected.
 *
 *  A grid rather than a list because he has a lot of campaigns and wants to
 *  see all of them on one page. The whole tile is one tap, so it is the one
 *  place on this screen a bordered card is allowed. */
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

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6">
      <ScreenHeader
        title="Briefs"
        aside={
          <Link to="/campaigns/new" aria-label="New campaign" className={`${buttonClass('ghost', 'small')} !rounded-full !px-3`}>
            <PlusIcon className="h-4 w-4" />
            New
          </Link>
        }
      />

      {campaigns === null ? null : campaigns.length === 0 ? (
        <p className="text-base text-state-later">No campaigns yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          {byLowestMinViews(byBestPay(campaigns, accounts)).map((campaign, index) => (
            <li key={campaign.id} className="settle-in flex" style={{ '--i': index } as CSSProperties}>
              <CampaignTile campaign={campaign} accounts={accounts} />
            </li>
          ))}
        </ul>
      )}

      {(loaded?.archived ?? 0) > 0 ? (
        <Link to="/campaigns/archived" className="meta self-start text-state-later underline">
          Archived ({loaded?.archived})
        </Link>
      ) : null}
    </section>
  )
}

/** Lowest minimum views first - the easiest bar to clear at the top. A
 *  campaign with no minimum set counts as zero and goes to the very top, his
 *  call: "the ones that have no minimum views set are automatically zero".
 *  The sort is stable, so campaigns with the same minimum keep the best-pay
 *  order they came in with. */
function byLowestMinViews<T extends Campaign>(campaigns: readonly T[]): T[] {
  return [...campaigns].sort((a, b) => (a.min_views ?? 0) - (b.min_views ?? 0))
}

/** One campaign: name, pay a day, minimum views, platform logos.
 *
 *  The day is the same figure the campaign page and MONEY show - a seventh of
 *  the week, or a thirtieth of the month he corrected - so the three screens
 *  never disagree. Missing values say "not saved yet" rather than a number. */
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
      className="press flex min-w-0 flex-1 flex-col gap-4 rounded-2xl border border-edge p-4 active:bg-surface"
    >
      <div className="min-w-0">
        <h2 className="display break-words text-xl leading-tight text-text md:text-2xl">{campaign.name}</h2>
        {platforms.length === 0 ? (
          <p className="meta mt-3 text-state-later">no accounts yet</p>
        ) : (
          <p
            role="img"
            aria-label={platforms.map((p) => p.platform).join(', ')}
            className="mt-3 flex flex-wrap gap-3 text-text"
          >
            {platforms.map((p) => (
              <PlatformGlyph key={p.id} platform={p.platform} className="h-7 w-7" />
            ))}
          </p>
        )}
      </div>

      <div className="mt-auto flex flex-col gap-3">
        <div>
          <p className="label text-state-later">per day</p>
          {earnings === null ? (
            <p className="mt-1 text-base text-state-later">not saved yet</p>
          ) : (
            <p className="numeric mt-1 text-[1.75rem] font-semibold leading-none text-text md:text-[2rem]">
              {formatCents(earnings.dayCents)}
            </p>
          )}
        </div>
        <div>
          <p className="label text-state-later">min views</p>
          {campaign.min_views == null ? (
            <p className="mt-1 text-base text-state-later">not saved yet</p>
          ) : (
            <p className="numeric mt-1 text-2xl font-semibold leading-none text-text">
              {formatViews(campaign.min_views)}
            </p>
          )}
        </div>
      </div>
    </Link>
  )
}
