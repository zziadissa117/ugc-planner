import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'

import { ChevronRightIcon, PlatformGlyph, PlusIcon } from '../components/icons'
import { ScreenHeader } from '../components/ui'
import { INPUT_CLASS, buttonClass } from '../components/styles'
import type { Campaign, CampaignAccount } from '../data'
import { centsToDollarsInput, parseDollarsToCents } from '../data/campaignFields'
import { useData } from '../data/useData'
import {
  byBestPay,
  formatCents,
  hasMonthlyOverride,
  monthlyPayCents,
  payingPlatforms,
} from '../money'

/** Every campaign at a glance.
 *
 *  The per-video rate is the headline on the right: it is the number he
 *  negotiated and the one he checks. The month sits under the name, because it
 *  is derived - rate x posts per day x 30 - and because it is the one he
 *  corrects, so it has to be a control rather than part of the link. */
export function Campaigns() {
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

  const saveMonthly = useCallback(
    async (campaignId: string, cents: number | null) => {
      await data.updateCampaign(campaignId, { monthly_pay_override_cents: cents })
      await load()
    },
    [data, load],
  )

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <ScreenHeader
        title="Briefs"
        aside={
          <Link to="/campaigns/new" aria-label="New campaign" className={`${buttonClass('quiet', 'small')} !rounded-full !px-3`}>
            <PlusIcon className="h-4 w-4" />
            New
          </Link>
        }
      />

      {campaigns === null ? null : campaigns.length === 0 ? (
        <p className="text-base text-state-later">No campaigns yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule border-y border-rule">
          {byBestPay(campaigns, accounts).map((campaign, index) => {
            const platforms = accounts
              .filter((a) => a.campaign_id === campaign.id)
              .map((a) => a.platform)
            const paying = payingPlatforms(campaign, accounts)
            return (
              <li
                key={campaign.id}
                className="settle-in flex items-start gap-3 py-4"
                style={{ '--i': index } as CSSProperties}
              >
                <div className="min-w-0 flex-1">
                  <Link to={`/campaigns/${campaign.id}`} className="press block min-w-0 active:opacity-70">
                    <span className="script block break-words text-[2.125rem] leading-tight text-text">
                      {campaign.name}
                    </span>
                    <span className="mt-1.5 flex min-w-0 items-center gap-2 text-state-later">
                      {platforms.length === 0 ? (
                        <span className="meta">no platforms yet</span>
                      ) : (
                        <>
                          <span aria-hidden className="flex shrink-0 gap-1.5">
                            {platforms.map((platform) => (
                              <PlatformGlyph key={platform} platform={platform} className="h-4 w-4" />
                            ))}
                          </span>
                          <span className="meta truncate">{platforms.join(' · ')}</span>
                        </>
                      )}
                    </span>
                  </Link>

                  {/* The month is editable, so it cannot sit inside the link -
                      a control inside an anchor is a tap he cannot aim. */}
                  <MonthlyPay
                    campaign={campaign}
                    accounts={accounts}
                    onSave={(cents) => saveMonthly(campaign.id, cents)}
                  />
                </div>

                <Link
                  to={`/campaigns/${campaign.id}`}
                  className="press flex shrink-0 items-center gap-1 pt-2 text-right active:opacity-70"
                >
                  <span>
                    <span className="numeric block text-lg font-semibold text-text">
                      {campaign.pay_per_video_cents === null
                        ? 'no rate'
                        : `${formatCents(campaign.pay_per_video_cents)}/video`}
                    </span>
                    <span className="numeric meta block text-state-later">
                      {campaign.daily_post_quota}/day
                      {paying > 1 ? ` x ${paying}` : ''}
                    </span>
                  </span>
                  <ChevronRightIcon className="h-5 w-5 text-state-later" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      <Link to="/campaigns/new" className={buttonClass('quiet')}>
        <PlusIcon className="h-5 w-5" />
        New campaign
      </Link>
    </section>
  )
}

/** The month, and a way to correct it.
 *
 *  An estimate carries a "~" and says so; his own number does not. Clearing it
 *  puts the estimate back rather than storing a zero - a campaign he has
 *  un-corrected is not one paying nothing. */
function MonthlyPay({
  campaign,
  accounts,
  onSave,
}: {
  campaign: Campaign
  accounts: readonly CampaignAccount[]
  onSave: (cents: number | null) => Promise<void>
}) {
  const monthly = monthlyPayCents(campaign, accounts)
  const mine = hasMonthlyOverride(campaign)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function commit(cents: number | null) {
    setBusy(true)
    try {
      await onSave(cents)
      setEditing(false)
      setError(null)
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    const trimmed = draft.trim()
    if (trimmed === '') return commit(null)
    const cents = parseDollarsToCents(trimmed)
    if (cents === null) {
      setError('Enter an amount like 1000 or 1000.50.')
      return
    }
    await commit(cents)
  }

  if (editing) {
    return (
      <span className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save()
            if (event.key === 'Escape') setEditing(false)
          }}
          aria-label={`Pay per month for ${campaign.name}`}
          inputMode="decimal"
          placeholder="per month"
          autoFocus
          className={`${INPUT_CLASS} w-28 text-base`}
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className={buttonClass('now', 'small')}
        >
          Save
        </button>
        {mine ? (
          <button
            type="button"
            onClick={() => void commit(null)}
            disabled={busy}
            className={buttonClass('ghost', 'small')}
          >
            Reset
          </button>
        ) : null}
        {error ? <span className="meta text-state-blocked">{error}</span> : null}
      </span>
    )
  }

  return (
    <button
      type="button"
      aria-label={`Pay per month for ${campaign.name}`}
      onClick={() => {
        setDraft(monthly === null || !mine ? '' : centsToDollarsInput(monthly))
        setEditing(true)
      }}
      className="press meta mt-1.5 block whitespace-nowrap rounded text-left tabular-nums text-state-later underline decoration-edge-lit decoration-dotted underline-offset-4 active:opacity-70"
    >
      {monthly === null
        ? 'tap to set pay per month'
        : `${mine ? '' : '~'}${formatCents(monthly)}/mo · ${mine ? 'your figure' : 'estimate'}`}
    </button>
  )
}
