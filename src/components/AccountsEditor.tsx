// Where a campaign posts, and what to log into.
//
// A platform is picked from a list rather than typed. It used to be free text
// and the result was a real campaign holding one account called "Instagram &
// Youtube" with no handle - two platforms in one row, which no handle could
// describe and which the posting grid could only render as a single line.
// Picking from a list makes that unrepresentable; a platform not on the list
// can still be typed, but one at a time.
//
// Handle, email and password sit on one line per platform, because that is
// how they are used: at the moment of posting, together, for that one
// account. There is no campaign-level login any more - a creator runs a
// different account per platform.

import { useCallback, useEffect, useMemo, useState } from 'react'

import type { AccountStatus, CampaignAccount, DataAdapter } from '../data'

/** The platforms the app knows about. Free text still works underneath, so
 *  adding one here is a convenience rather than a migration. */
export const KNOWN_PLATFORMS = ['Instagram', 'TikTok', 'YouTube', 'Facebook', 'X', 'Snapchat'] as const

const STATUS_LABELS: Record<AccountStatus, string> = {
  new: 'New',
  warming: 'Warming',
  ready: 'Ready',
}

const STATUS_ORDER: AccountStatus[] = ['new', 'warming', 'ready']

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
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [custom, setCustom] = useState('')
  const [adding, setAdding] = useState(false)

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

  const chosen = useMemo(
    () => new Set(accounts.map((a) => a.platform.toLowerCase())),
    [accounts],
  )

  const add = useCallback(
    async (platform: string) => {
      const name = platform.trim()
      if (name === '') return
      if (chosen.has(name.toLowerCase())) {
        setError(`${name} is already on this campaign.`)
        return
      }
      setBusy(true)
      setError(null)
      try {
        await data.addCampaignAccount({
          campaign_id: campaignId,
          platform: name,
          handle: null,
          email: null,
          password: null,
          // Posting is not gated on warm-up any more, so a new account is
          // immediately usable; the warm-up screen still tracks it.
          status: 'new',
          sort_order: accounts.length,
        })
        setCustom('')
        await refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught))
      } finally {
        setBusy(false)
      }
    },
    [accounts.length, campaignId, chosen, data, refresh],
  )

  const patch = useCallback(
    async (id: string, change: Partial<CampaignAccount>) => {
      await data.updateCampaignAccount(id, change)
      await refresh()
    },
    [data, refresh],
  )

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-state-later">
          Platforms
        </h2>
        <button
          type="button"
          onClick={() => setAdding((open) => !open)}
          aria-expanded={adding}
          className="rounded-md border border-edge px-2 py-0.5 text-xs font-semibold text-state-later active:bg-surface-raised"
        >
          {adding ? 'Done' : 'Add'}
        </button>
      </div>

      {accounts.length === 0 ? (
        <p className="mt-1 text-sm text-state-blocked">
          None yet - add the platforms this campaign posts to.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {accounts.map((account) => (
            <li key={account.id}>
              <AccountRow account={account} onPatch={patch} />
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="mt-2 rounded-lg border border-edge bg-surface p-2">
          <div className="flex flex-wrap gap-1.5">
            {KNOWN_PLATFORMS.map((name) => {
              const already = chosen.has(name.toLowerCase())
              return (
                <button
                  key={name}
                  type="button"
                  disabled={busy || already}
                  onClick={() => void add(name)}
                  aria-pressed={already}
                  className={[
                    'rounded-md border px-2.5 py-1 text-sm font-semibold active:bg-surface',
                    already
                      ? 'border-state-posted/50 bg-state-posted/10 text-state-posted'
                      : 'border-edge bg-surface-raised text-text',
                  ].join(' ')}
                >
                  {already ? `${name} ✓` : name}
                </button>
              )
            })}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              aria-label="Other platform"
              placeholder="Other platform"
              className="min-h-tap min-w-0 flex-1 rounded-md border border-edge bg-surface-raised px-2 text-sm text-text placeholder:text-state-later"
            />
            <button
              type="button"
              onClick={() => void add(custom)}
              disabled={busy || custom.trim() === ''}
              className="min-h-tap shrink-0 rounded-md border border-edge px-3 text-sm font-semibold text-text active:bg-surface-raised disabled:text-state-later"
            >
              Add
            </button>
          </div>
          {error ? <p className="mt-1.5 text-sm text-state-blocked">{error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

/** One platform: handle, email and password on one line, then the warm-up
 *  state. The password is masked until asked for - it is looked up in front
 *  of whoever is in the room. */
function AccountRow({
  account,
  onPatch,
}: {
  account: CampaignAccount
  onPatch: (id: string, change: Partial<CampaignAccount>) => Promise<void>
}) {
  const [show, setShow] = useState(false)

  const field = (key: 'handle' | 'email' | 'password', value: string) =>
    void onPatch(account.id, { [key]: value.trim() === '' ? null : value })

  return (
    <div className="rounded-lg border border-edge bg-surface px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-20 shrink-0 truncate text-sm font-semibold text-text">
          {account.platform}
        </span>

        <input
          defaultValue={account.handle ?? ''}
          onBlur={(event) => field('handle', event.target.value)}
          aria-label={`${account.platform} handle`}
          placeholder="@handle"
          className="min-h-tap w-28 min-w-0 flex-1 rounded-md border border-edge bg-surface-raised px-2 text-sm text-text placeholder:text-state-later"
        />
        <input
          defaultValue={account.email ?? ''}
          onBlur={(event) => field('email', event.target.value)}
          aria-label={`${account.platform} email`}
          placeholder="email"
          autoComplete="off"
          className="min-h-tap w-32 min-w-0 flex-1 rounded-md border border-edge bg-surface-raised px-2 text-sm text-text placeholder:text-state-later"
        />
        <input
          defaultValue={account.password ?? ''}
          onBlur={(event) => field('password', event.target.value)}
          type={show ? 'text' : 'password'}
          aria-label={`${account.platform} password`}
          placeholder="password"
          autoComplete="new-password"
          className="min-h-tap w-28 min-w-0 flex-1 rounded-md border border-edge bg-surface-raised px-2 text-sm text-text placeholder:text-state-later"
        />
        <button
          type="button"
          onClick={() => setShow((current) => !current)}
          className="shrink-0 rounded-md border border-edge px-2 py-1 text-xs font-semibold text-state-later active:bg-surface-raised"
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>

      <div className="mt-1 flex items-center gap-1.5">
        {STATUS_ORDER.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => void onPatch(account.id, { status })}
            aria-pressed={account.status === status}
            className={[
              'rounded px-1.5 py-0.5 label',
              account.status === status
                ? 'bg-surface-raised text-state-now'
                : 'text-state-later active:bg-surface-raised',
            ].join(' ')}
          >
            {STATUS_LABELS[status]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void onPatch(account.id, { is_active: false })}
          className="ml-auto rounded px-1.5 py-0.5 label text-state-later active:bg-surface-raised"
        >
          Remove
        </button>
      </div>
    </div>
  )
}
