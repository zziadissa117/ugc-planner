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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

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
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold uppercase tracking-wide text-text">Platforms</h2>
        <button
          type="button"
          onClick={() => setAdding((open) => !open)}
          aria-expanded={adding}
          className="min-h-tap rounded-lg border border-edge px-4 text-base font-semibold text-text active:bg-surface-raised"
        >
          {adding ? 'Done' : 'Add'}
        </button>
      </div>

      {accounts.length === 0 ? (
        <p className="mt-2 text-base text-state-blocked">
          None yet - add the platforms this campaign posts to.
        </p>
      ) : (
        <ul className="mt-3 grid gap-3 md:grid-cols-2">
          {accounts.map((account) => (
            <li key={account.id}>
              <AccountRow account={account} onPatch={patch} />
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="mt-3 rounded-lg border border-edge bg-surface p-3">
          <div className="flex flex-wrap gap-2">
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
                    'min-h-tap rounded-lg border px-4 text-base font-semibold active:bg-surface',
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
              className="min-h-tap min-w-0 flex-1 rounded-lg border border-edge bg-surface-raised px-3 text-base text-text placeholder:text-state-later"
            />
            <button
              type="button"
              onClick={() => void add(custom)}
              disabled={busy || custom.trim() === ''}
              className="min-h-tap shrink-0 rounded-lg border border-edge px-4 text-base font-semibold text-text active:bg-surface-raised disabled:text-state-later"
            >
              Add
            </button>
          </div>
          {error ? <p className="mt-2 text-base text-state-blocked">{error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

/** Whether this browser can hide the characters of a plain text box.
 *
 *  A password has to be masked and still show every character it holds, and an
 *  <input> cannot do both: it is one line, so a long value is cut off at the
 *  edge of the box and only the part in view is ever visible. A textarea wraps,
 *  and `-webkit-text-security` masks it. Where that is not supported the box
 *  falls back to a real password input rather than showing the secret. */
const CAN_MASK_TEXT =
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('-webkit-text-security', 'disc')

/** A one-value box that grows to hold everything in it.
 *
 *  A handle or an email longer than the box used to be clipped, and the only
 *  way to read the rest was to tap in and scroll along it - "i can only see
 *  the full username when i click on it". This wraps instead, so the whole
 *  value is on screen at rest. Enter saves rather than adding a line, because
 *  none of these values has one. */
function GrowingBox({
  value,
  onCommit,
  label,
  placeholder,
  className,
  mask,
  ...rest
}: {
  value: string
  onCommit: (next: string) => void
  label: string
  placeholder: string
  className: string
  /** Hide the characters (only when CAN_MASK_TEXT). */
  mask?: boolean
  autoComplete?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const fit = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    // 0 in a layout-less environment; leave the height alone rather than
    // collapsing the box.
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`
  }, [])

  useLayoutEffect(fit, [fit, value])
  useEffect(() => {
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [fit])

  return (
    <textarea
      ref={ref}
      rows={1}
      defaultValue={value}
      onInput={fit}
      onBlur={(event) => onCommit(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        }
      }}
      aria-label={label}
      placeholder={placeholder}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      style={mask ? ({ WebkitTextSecurity: 'disc' } as CSSProperties) : undefined}
      className={`${className} resize-none overflow-hidden py-3 leading-snug [overflow-wrap:anywhere]`}
      {...rest}
    />
  )
}

/** The captions are aria-hidden on purpose: each box already has a full
 *  accessible name ("Instagram email"), and a second label reading just
 *  "Email" is what once made a campaign-level Email field look like it still
 *  existed to anything asking.
 *
 *  One platform, as its own card: the platform, then the handle, the email and
 *  the password each on a full-width line of their own with a caption above.
 *
 *  These used to sit side by side on one line, three narrow boxes at 14px in a
 *  column of a two-column page, and on a phone that left each of them showing a
 *  few characters of what was in it - the login he needs at the moment of
 *  posting, and the one thing he could not read at a glance. So they are large
 *  and stacked, and every value is on show. The password is the exception: it
 *  stays masked because it is looked up in front of whoever is in the room, but
 *  the box is just as big and one tap on Show reveals it. */
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

  const box =
    'min-h-tap w-full min-w-0 rounded-lg border border-edge bg-surface-raised px-3 text-lg text-text placeholder:text-state-later'

  return (
    <div className="rounded-xl border border-edge bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xl font-semibold text-text">{account.platform}</span>
        <button
          type="button"
          onClick={() => void onPatch(account.id, { is_active: false })}
          className="min-h-tap shrink-0 rounded-lg px-3 text-base text-state-later active:bg-surface-raised"
        >
          Remove
        </button>
      </div>

      <div className="mt-1 flex flex-col gap-3">
        <div>
          <span aria-hidden className="label text-state-later">
            Handle
          </span>
          <GrowingBox
            value={account.handle ?? ''}
            onCommit={(next) => field('handle', next)}
            label={`${account.platform} handle`}
            placeholder="@handle - not saved yet"
            className={`${box} mt-1 font-semibold`}
          />
        </div>

        <div>
          <span aria-hidden className="label text-state-later">
            Email
          </span>
          <GrowingBox
            value={account.email ?? ''}
            onCommit={(next) => field('email', next)}
            label={`${account.platform} email`}
            placeholder="email - not saved yet"
            autoComplete="off"
            className={`${box} mt-1`}
          />
        </div>

        <div>
          <span aria-hidden className="label text-state-later">
            Password
          </span>
          <div className="mt-1 flex items-start gap-2">
            {CAN_MASK_TEXT ? (
              <GrowingBox
                value={account.password ?? ''}
                onCommit={(next) => field('password', next)}
                label={`${account.platform} password`}
                placeholder="password - not saved yet"
                autoComplete="new-password"
                mask={!show}
                className={box}
              />
            ) : (
              <input
                defaultValue={account.password ?? ''}
                onBlur={(event) => field('password', event.target.value)}
                type={show ? 'text' : 'password'}
                aria-label={`${account.platform} password`}
                placeholder="password - not saved yet"
                autoComplete="new-password"
                autoCapitalize="none"
                autoCorrect="off"
                className={box}
              />
            )}
            <button
              type="button"
              onClick={() => setShow((current) => !current)}
              className="min-h-tap shrink-0 rounded-lg border border-edge px-4 text-base font-semibold text-text active:bg-surface-raised"
            >
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span aria-hidden className="label text-state-later">Status</span>
        {STATUS_ORDER.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => void onPatch(account.id, { status })}
            aria-pressed={account.status === status}
            className={[
              'min-h-[2.75rem] flex-1 rounded-lg border px-2 text-base font-semibold',
              account.status === status
                ? 'border-state-now/60 bg-surface-raised text-state-now'
                : 'border-edge text-state-later active:bg-surface-raised',
            ].join(' ')}
          >
            {STATUS_LABELS[status]}
          </button>
        ))}
      </div>
    </div>
  )
}
