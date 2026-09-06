// Where a campaign actually posts.
//
// His words: "inflow post 1 on ig 1 on tiktok with this handle; and vertus 2
// on yt 2 on ig w this handle". A single per-campaign quota could not say
// that, and a handle was never a claim about a document - no brief states one
// - so these stopped being campaign_fields and became rows of their own.
//
// One video is cross-posted to every account and is still one deliverable,
// which is contractual for Inflow. So the campaign's daily video demand is the
// MAX of posts_per_day across its ready accounts, never the sum.

import { useCallback, useEffect, useState } from 'react'

import type { AccountStatus, CampaignAccount, DataAdapter } from '../data'
import { ACCOUNT_STATUS_VALUES } from '../data'

/** The platforms his campaigns actually use. Free text underneath, so adding
 *  one is typing, not a migration - these are just the ones worth a button. */
const SUGGESTED_PLATFORMS = ['TikTok', 'Instagram', 'YouTube'] as const

const STATUS_LABELS: Record<AccountStatus, string> = {
  new: 'New',
  warming: 'Warming up',
  ready: 'Ready to post',
}

export function AccountsEditor({
  data,
  campaignId,
  onChanged,
}: {
  data: DataAdapter
  campaignId: string
  onChanged?: () => void
}) {
  const [accounts, setAccounts] = useState<CampaignAccount[]>([])
  const [platform, setPlatform] = useState('')
  const [handle, setHandle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setAccounts(await data.listCampaignAccounts(campaignId))
  }, [campaignId, data])

  useEffect(() => {
    void reload()
  }, [reload])

  const refresh = useCallback(async () => {
    await reload()
    onChanged?.()
  }, [onChanged, reload])

  async function add() {
    const name = platform.trim()
    if (name === '') return
    setBusy(true)
    setError(null)
    try {
      await data.addCampaignAccount({
        campaign_id: campaignId,
        platform: name,
        handle: handle.trim() === '' ? null : handle.trim(),
        posts_per_day: 1,
        status: 'new',
        sort_order: accounts.length,
      })
      setPlatform('')
      setHandle('')
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  async function patch(id: string, change: Partial<CampaignAccount>) {
    await data.updateCampaignAccount(id, change)
    await refresh()
  }

  const noHandle = accounts.length > 0 && accounts.every((a) => a.handle === null)

  return (
    <div>
      <h2 className="text-lg font-semibold text-text">Accounts</h2>
      <p className="mt-1 text-sm text-state-later">
        Where this campaign posts. One video goes to all of them and still counts once.
      </p>

      {accounts.length === 0 ? (
        <p className="mt-2 text-sm font-semibold text-state-blocked">
          No accounts yet - nothing can be posted until there is at least one.
        </p>
      ) : noHandle ? (
        <p className="mt-2 text-sm font-semibold text-state-blocked">
          No @ handle saved on any account.
        </p>
      ) : null}

      <ul className="mt-3 flex flex-col gap-3">
        {accounts.map((account) => (
          <li key={account.id} className="rounded-lg border border-edge bg-surface p-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-semibold text-text">{account.platform}</p>
              <button
                type="button"
                onClick={() => void patch(account.id, { is_active: false })}
                className="text-xs font-semibold uppercase tracking-wide text-state-later"
              >
                Remove
              </button>
            </div>

            <label className="mt-2 block">
              <span className="text-xs font-semibold uppercase tracking-wide text-state-later">
                {account.platform} handle
              </span>
              <input
                value={account.handle ?? ''}
                onChange={(event) =>
                  void patch(account.id, {
                    handle: event.target.value.trim() === '' ? null : event.target.value,
                  })
                }
                placeholder="@handle"
                className="mt-1 min-h-tap w-full rounded-lg border border-edge bg-surface-raised px-3 text-text placeholder:text-state-later"
              />
            </label>

            <label className="mt-2 block">
              <span className="text-xs font-semibold uppercase tracking-wide text-state-later">
                Posts per day on {account.platform}
              </span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={account.posts_per_day}
                onChange={(event) => {
                  const next = Number(event.target.value)
                  if (Number.isInteger(next) && next >= 0) {
                    void patch(account.id, { posts_per_day: next })
                  }
                }}
                className="mt-1 min-h-tap w-full rounded-lg border border-edge bg-surface-raised px-3 text-text"
              />
            </label>

            <div className="mt-2 flex flex-wrap gap-2">
              {ACCOUNT_STATUS_VALUES.map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => void patch(account.id, { status })}
                  aria-pressed={account.status === status}
                  className={[
                    'min-h-tap rounded-lg border px-3 text-sm font-semibold active:bg-surface-raised',
                    account.status === status
                      ? 'border-state-now bg-surface-raised text-state-now'
                      : 'border-edge bg-surface text-state-later',
                  ].join(' ')}
                >
                  {STATUS_LABELS[status]}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-3 rounded-lg border border-edge bg-surface p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-state-later">
          Add an account
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {SUGGESTED_PLATFORMS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setPlatform(name)}
              className="min-h-tap rounded-lg border border-edge bg-surface-raised px-3 text-sm font-semibold text-state-later active:bg-surface"
            >
              {name}
            </button>
          ))}
        </div>
        <input
          value={platform}
          onChange={(event) => setPlatform(event.target.value)}
          aria-label="Platform"
          placeholder="Platform"
          className="mt-2 min-h-tap w-full rounded-lg border border-edge bg-surface-raised px-3 text-text placeholder:text-state-later"
        />
        <input
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          aria-label="Handle"
          placeholder="@handle"
          className="mt-2 min-h-tap w-full rounded-lg border border-edge bg-surface-raised px-3 text-text placeholder:text-state-later"
        />
        {error ? <p className="mt-2 text-sm text-state-blocked">{error}</p> : null}
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy || platform.trim() === ''}
          className="mt-2 min-h-tap w-full rounded-lg border border-edge bg-surface px-4 font-semibold text-text active:bg-surface-raised disabled:text-state-later"
        >
          Add account
        </button>
      </div>
    </div>
  )
}
