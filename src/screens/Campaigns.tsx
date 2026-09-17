import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import type { Campaign, CampaignAccount } from '../data'
import { centsToDollarsInput, parseDollarsToCents } from '../data/campaignFields'
import { useData } from '../data/useData'
import { formatCents, hasMonthlyOverride, monthlyPayCents } from '../money'

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
    <section className="mx-auto flex max-w-3xl flex-col gap-3">
      <h1 className="text-xl font-semibold text-text">Briefs</h1>

      {campaigns === null ? null : campaigns.length === 0 ? (
        <p className="text-sm text-state-later">No campaigns yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {campaigns.map((campaign) => {
            const platforms = accounts
              .filter((a) => a.campaign_id === campaign.id)
              .map((a) => a.platform)
            return (
              <li
                key={campaign.id}
                className="flex items-center gap-3 rounded-lg border border-edge bg-surface px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/campaigns/${campaign.id}`}
                    className="block min-w-0 active:opacity-70"
                  >
                    <span className="block truncate font-semibold text-text">{campaign.name}</span>
                    <span className="block truncate text-xs text-state-later">
                      {platforms.length === 0 ? 'no platforms yet' : platforms.join(' · ')}
                    </span>
                  </Link>

                  {/* The month is editable, so it cannot sit inside the link -
                      a control inside an anchor is a tap he cannot aim. */}
                  <MonthlyPay
                    campaign={campaign}
                    onSave={(cents) => saveMonthly(campaign.id, cents)}
                  />
                </div>

                <Link
                  to={`/campaigns/${campaign.id}`}
                  className="shrink-0 text-right active:opacity-70"
                >
                  <span className="block text-sm font-semibold tabular-nums text-text">
                    {campaign.pay_per_video_cents === null
                      ? 'no rate'
                      : `${formatCents(campaign.pay_per_video_cents)}/video`}
                  </span>
                  <span className="block text-xs tabular-nums text-state-later">
                    {campaign.daily_post_quota}/day
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      <Link
        to="/campaigns/new"
        className="flex min-h-tap items-center justify-center rounded-lg border border-edge bg-surface px-4 text-sm font-semibold text-text active:bg-surface-raised"
      >
        + New campaign
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
  onSave,
}: {
  campaign: Campaign
  onSave: (cents: number | null) => Promise<void>
}) {
  const monthly = monthlyPayCents(campaign)
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
      <span className="mt-1 flex items-center gap-1">
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
          className="min-h-tap w-24 rounded-md border border-state-now bg-surface-raised px-2 text-sm text-text placeholder:text-state-later"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="rounded-md border border-state-now px-2 py-1 text-xs font-semibold text-state-now active:bg-surface disabled:opacity-60"
        >
          Save
        </button>
        {mine ? (
          <button
            type="button"
            onClick={() => void commit(null)}
            disabled={busy}
            className="rounded-md border border-edge px-2 py-1 text-xs font-semibold text-state-later active:bg-surface-raised disabled:opacity-60"
          >
            Reset
          </button>
        ) : null}
        {error ? <span className="text-xs text-state-blocked">{error}</span> : null}
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
      className="mt-0.5 block rounded text-left text-xs tabular-nums text-state-later active:opacity-70"
    >
      {monthly === null
        ? 'tap to set pay per month'
        : `${mine ? '' : '~'}${formatCents(monthly)}/mo · ${mine ? 'your figure' : 'estimate'}`}
    </button>
  )
}
