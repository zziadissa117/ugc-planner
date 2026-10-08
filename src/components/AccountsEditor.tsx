// Where a campaign posts, and what to log into.
//
// A platform is picked from a list rather than typed. It used to be free text
// and the result was a real campaign holding one account called "Instagram &
// Youtube" with no handle - two platforms in one row, which no handle could
// describe and which the posting grid could only render as a single line.
// Picking from a list makes that unrepresentable; a platform not on the list
// can still be typed, but one at a time.
//
// The logins are the point of this block - "all I need is to know the account
// logins" - so they are large, readable, and each has a Copy button. Most
// campaigns use one email and one password for every platform, so there are
// two ways to hold them:
//
//   - Same login for all: one email and one password, shown once, and each
//     platform row shows just its username.
//   - Different login per account: each row has its own email and password.
//
// Either way the login is stored on each account row, as the schema says it
// belongs to the account: "same for all" simply writes the same values to
// every row. Which way he looks at it is remembered on this device per
// campaign; until he picks, it is "same" when every account already shares
// one login (or none has one yet), "different" otherwise.
//
// The rarely touched per-account settings - warm-up state, a platform's own
// pay rate, bonus-only, remove - sit behind a "More" button on each row.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import { useLoaded } from '../data/useLoaded'

import type { AccountStatus, CampaignAccount, DataAdapter } from '../data'
import { centsToDollarsInput, parseDollarsToCents } from '../data/campaignFields'
import { loginsMatch, sharedLogin } from '../data/logins'
import { KNOWN_PLATFORMS } from './platforms'
import { INPUT_CLASS, buttonClass } from './styles'

const STATUS_LABELS: Record<AccountStatus, string> = {
  new: 'New',
  warming: 'Warming',
  ready: 'Ready',
}

const STATUS_ORDER: AccountStatus[] = ['new', 'warming', 'ready']

type LoginMode = 'shared' | 'separate'

const modeKey = (campaignId: string) => `ugc-planner.login-mode.${campaignId}`

function readMode(campaignId: string): LoginMode | null {
  try {
    const value = localStorage.getItem(modeKey(campaignId))
    return value === 'shared' || value === 'separate' ? value : null
  } catch {
    return null
  }
}

function writeMode(campaignId: string, mode: LoginMode) {
  try {
    localStorage.setItem(modeKey(campaignId), mode)
  } catch {
    // Not remembered: it is worked out from the logins next time.
  }
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
  const [loaded, reload] = useLoaded(() => data.listCampaignAccounts(campaignId), [campaignId, data])
  const accounts = useMemo(() => loaded ?? [], [loaded])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [custom, setCustom] = useState('')
  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState<LoginMode | null>(() => readMode(campaignId))
  /** Asking before one login overwrites several different ones. */
  const [confirming, setConfirming] = useState(false)

  const mode: LoginMode = picked ?? (loginsMatch(accounts) ? 'shared' : 'separate')
  const shared = sharedLogin(accounts)

  const refresh = useCallback(async () => {
    await reload()
    onChanged?.()
  }, [onChanged, reload])

  const choose = (next: LoginMode) => {
    setPicked(next)
    writeMode(campaignId, next)
  }

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
          // With one login for all, a new platform gets it too.
          email: mode === 'shared' && shared.email !== '' ? shared.email : null,
          password: mode === 'shared' && shared.password !== '' ? shared.password : null,
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
    [accounts.length, campaignId, chosen, data, mode, refresh, shared.email, shared.password],
  )

  const patch = useCallback(
    async (id: string, change: Partial<CampaignAccount>) => {
      await data.updateCampaignAccount(id, change)
      await refresh()
    },
    [data, refresh],
  )

  /** One value written to every account that does not already hold it. */
  const setForAll = useCallback(
    async (key: 'email' | 'password', value: string) => {
      const next = value.trim() === '' ? null : value
      for (const account of accounts) {
        if ((account[key] ?? null) !== next) await data.updateCampaignAccount(account.id, { [key]: next })
      }
      await refresh()
    },
    [accounts, data, refresh],
  )

  const applyOneLogin = async () => {
    for (const account of accounts) {
      if ((account.email ?? '') !== shared.email || (account.password ?? '') !== shared.password) {
        await data.updateCampaignAccount(account.id, {
          email: shared.email === '' ? null : shared.email,
          password: shared.password === '' ? null : shared.password,
        })
      }
    }
    setConfirming(false)
    choose('shared')
    await refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="label shrink-0 text-state-later">Accounts</h2>
        <span aria-hidden className="h-px flex-1 bg-rule" />
        <button
          type="button"
          onClick={() => setAdding((open) => !open)}
          aria-expanded={adding}
          className={`${buttonClass(adding ? 'now' : 'quiet', 'small')} !min-h-9 !rounded-full`}
        >
          {adding ? 'Done' : 'Add'}
        </button>
      </div>

      {/* Which way the logins are held. Two plain choices, one pressed. */}
      <div role="group" aria-label="Login" className="flex flex-wrap gap-2">
        <ModeButton on={mode === 'shared'} onClick={() => (loginsMatch(accounts) ? choose('shared') : setConfirming(true))}>
          Same login for all accounts
        </ModeButton>
        <ModeButton on={mode === 'separate'} onClick={() => { setConfirming(false); choose('separate') }}>
          Different login per account
        </ModeButton>
      </div>

      {confirming ? (
        <div className="settle-in flex flex-col gap-2 border-l-2 border-state-waiting pl-3">
          <p className="text-base text-text">
            These accounts have different logins. Use the {shared.from?.platform ?? 'first'} login
            {shared.email ? ` (${shared.email})` : ''} for every account?
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void applyOneLogin()} className={buttonClass('waiting', 'small')}>
              Use it for all
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={buttonClass('quiet', 'small')}>
              Keep them different
            </button>
          </div>
        </div>
      ) : null}

      {mode === 'shared' && accounts.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-xl border border-rule p-3">
          <LoginLine
            key={`email-${shared.email}`}
            name="Email"
            value={shared.email}
            label="Email for all accounts"
            placeholder="email"
            onCommit={(next) => void setForAll('email', next)}
          />
          <LoginLine
            key={`password-${shared.password}`}
            name="Password"
            value={shared.password}
            label="Password for all accounts"
            placeholder="password"
            secret
            onCommit={(next) => void setForAll('password', next)}
          />
        </div>
      ) : null}

      {accounts.length === 0 ? (
        <p className="text-base text-state-blocked">None yet - add the platforms this campaign posts to.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule border-y border-rule">
          {accounts.map((account) => (
            <li key={account.id} className="py-3">
              <AccountRow account={account} separate={mode === 'separate'} onPatch={patch} />
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="settle-in rounded-xl border border-rule p-2.5">
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
                    'press min-h-10 rounded-full border px-3 text-sm font-semibold active:bg-surface',
                    already
                      ? 'border-state-posted/50 bg-state-posted/10 text-state-posted'
                      : 'border-edge text-text',
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
              className={`${INPUT_CLASS} min-w-0 flex-1 text-base`}
            />
            <button
              type="button"
              onClick={() => void add(custom)}
              disabled={busy || custom.trim() === ''}
              className={buttonClass('quiet')}
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

function ModeButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={[
        'press min-h-10 rounded-full border px-4 text-sm font-semibold',
        on ? 'border-state-now/80 bg-surface-raised text-state-now' : 'border-edge text-state-later active:bg-surface',
      ].join(' ')}
    >
      {children}
    </button>
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

const BOX_CLASS =
  'min-h-tap min-w-0 flex-1 rounded-lg border border-edge bg-surface px-3 text-base text-text placeholder:text-state-later focus:border-state-now/80 focus:outline-none'

/** A one-value box that grows to hold everything in it.
 *
 *  A handle or an email longer than the box used to be clipped, and the only
 *  way to read the rest was to tap in and scroll along it - "i can only see
 *  the full username when i click on it". This wraps instead, so the whole
 *  value is on screen at rest, in the same place as the input it replaces.
 *  Enter saves rather than adding a line, because none of these values has
 *  one. */
function GrowingBox({
  value,
  onCommit,
  label,
  placeholder,
  className,
  mask,
  autoComplete,
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
      autoComplete={autoComplete}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      style={mask ? ({ WebkitTextSecurity: 'disc' } as CSSProperties) : undefined}
      className={`${className} resize-none overflow-hidden py-3 leading-snug [overflow-wrap:anywhere]`}
    />
  )
}

/** Copies one saved value. Says so for a moment, and does nothing for an
 *  empty one. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])
  return (
    <button
      type="button"
      aria-label={label}
      disabled={value === ''}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => setCopied(true))
          .catch(() => {})
      }}
      className={`press mt-1.5 shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold active:bg-surface disabled:opacity-40 ${
        copied ? 'border-state-posted/60 text-state-posted' : 'border-edge text-state-later'
      }`}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

/** One login value - a name on the left, the box, then Show (for a secret)
 *  and Copy. */
function LoginLine({
  name,
  value,
  label,
  placeholder,
  secret = false,
  onCommit,
}: {
  name: string
  value: string
  label: string
  placeholder: string
  secret?: boolean
  onCommit: (next: string) => void
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="label mt-4 w-24 shrink-0 text-state-later">{name}</span>
      {secret && !CAN_MASK_TEXT ? (
        <input
          defaultValue={value}
          onBlur={(event) => onCommit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          type={show ? 'text' : 'password'}
          aria-label={label}
          placeholder={placeholder}
          autoComplete="new-password"
          className={BOX_CLASS}
        />
      ) : (
        <GrowingBox
          value={value}
          onCommit={onCommit}
          label={label}
          placeholder={placeholder}
          autoComplete={secret ? 'new-password' : 'off'}
          mask={secret && !show}
          className={BOX_CLASS}
        />
      )}
      {secret ? (
        <button
          type="button"
          onClick={() => setShow((current) => !current)}
          className="press mt-1.5 shrink-0 rounded-full border border-edge px-3 py-1.5 text-sm font-semibold text-state-later active:bg-surface"
        >
          {show ? 'Hide' : 'Show'}
        </button>
      ) : null}
      <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
    </div>
  )
}

/** What one post on this platform pays, when it differs from the campaign's
 *  rate. Blank means it has no rate of its own and the campaign's applies -
 *  never a guess. Setting one makes the campaign pay each platform separately
 *  (see paysPerPlatform in data/earnings.ts), so the box says so. */
function PlatformRate({
  account,
  onPatch,
}: {
  account: CampaignAccount
  onPatch: (id: string, change: Partial<CampaignAccount>) => Promise<void>
}) {
  const [invalid, setInvalid] = useState(false)

  return (
    <label className="flex items-center gap-1.5">
      <span className="label text-state-later">Pays</span>
      <input
        key={account.pay_per_post_cents ?? 'none'}
        defaultValue={account.pay_per_post_cents === null ? '' : centsToDollarsInput(account.pay_per_post_cents)}
        onBlur={(event) => {
          const raw = event.target.value.trim()
          if (raw === '') {
            setInvalid(false)
            if (account.pay_per_post_cents !== null) void onPatch(account.id, { pay_per_post_cents: null })
            return
          }
          const cents = parseDollarsToCents(raw)
          if (cents === null) {
            setInvalid(true)
            return
          }
          setInvalid(false)
          if (cents !== account.pay_per_post_cents) void onPatch(account.id, { pay_per_post_cents: cents })
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
        inputMode="decimal"
        autoComplete="off"
        aria-label={`${account.platform} pay per post`}
        aria-invalid={invalid}
        placeholder="campaign rate"
        className={`w-28 rounded-lg border bg-surface px-2 py-1.5 text-sm text-text placeholder:text-state-later focus:outline-none ${
          invalid ? 'border-state-blocked' : 'border-edge focus:border-state-now/80'
        }`}
      />
    </label>
  )
}

/** One platform: its username, and - when each account has its own login -
 *  its email and password. The password is masked until asked for: it is
 *  looked up in front of whoever is in the room. */
function AccountRow({
  account,
  separate,
  onPatch,
}: {
  account: CampaignAccount
  /** Each account has its own email and password on this campaign. */
  separate: boolean
  onPatch: (id: string, change: Partial<CampaignAccount>) => Promise<void>
}) {
  const [more, setMore] = useState(false)

  const field = (key: 'handle' | 'email' | 'password', value: string) =>
    void onPatch(account.id, { [key]: value.trim() === '' ? null : value })

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {/* Name only: a glyph in this slot cut "Instagram" to "Insta...". */}
        <span className="min-w-0 flex-1 text-lg font-semibold text-text">{account.platform}</span>
        <button
          type="button"
          onClick={() => setMore((open) => !open)}
          aria-expanded={more}
          aria-label={`More for ${account.platform}`}
          className="press shrink-0 rounded-full px-3 py-1 text-sm font-semibold text-state-later active:bg-surface"
        >
          {more ? 'Less' : 'More'}
        </button>
      </div>

      <LoginLine
        name="Username"
        value={account.handle ?? ''}
        label={`${account.platform} handle`}
        placeholder="@handle"
        onCommit={(next) => field('handle', next)}
      />
      {separate ? (
        <>
          <LoginLine
            name="Email"
            value={account.email ?? ''}
            label={`${account.platform} email`}
            placeholder="email"
            onCommit={(next) => field('email', next)}
          />
          <LoginLine
            name="Password"
            value={account.password ?? ''}
            label={`${account.platform} password`}
            placeholder="password"
            secret
            onCommit={(next) => field('password', next)}
          />
        </>
      ) : null}

      {more ? (
        <div className="settle-in flex flex-wrap items-center gap-2 pl-[6.5rem]">
          {STATUS_ORDER.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => void onPatch(account.id, { status })}
              aria-pressed={account.status === status}
              className={[
                'press rounded-full px-2.5 py-1 label',
                account.status === status ? 'bg-surface-raised text-state-now' : 'text-state-later active:bg-surface',
              ].join(' ')}
            >
              {STATUS_LABELS[status]}
            </button>
          ))}
          <PlatformRate account={account} onPatch={onPatch} />
          {/* Paid only through view-milestone bonuses: its ticks on the Post
              screen earn nothing and are never owed. */}
          <button
            type="button"
            onClick={() => void onPatch(account.id, { bonus_only: !account.bonus_only })}
            aria-pressed={account.bonus_only}
            className={[
              'press rounded-full px-2.5 py-1 label',
              account.bonus_only ? 'bg-surface-raised text-state-now' : 'text-state-later active:bg-surface',
            ].join(' ')}
          >
            Bonus only
          </button>
          <button
            type="button"
            onClick={() => void onPatch(account.id, { is_active: false })}
            className="press ml-auto rounded-full px-2.5 py-1 label text-state-later active:bg-surface"
          >
            Remove
          </button>
        </div>
      ) : null}
    </div>
  )
}
