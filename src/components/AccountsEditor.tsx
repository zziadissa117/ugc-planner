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
import { KNOWN_PLATFORMS } from './platforms'
import { INPUT_CLASS, buttonClass } from './styles'


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
      <div className="flex items-center gap-3">
        <h2 className="label shrink-0 text-state-later">Platforms</h2>
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

      {accounts.length === 0 ? (
        <p className="mt-2 text-base text-state-blocked">
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
        <div className="settle-in mt-2 rounded-xl border border-rule p-2.5">
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
 *  value is on screen at rest, in the same place as the input it replaces. Enter saves rather than adding a line, because none of
 *  these values has one. */
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
      className={`${className} resize-none overflow-hidden py-[1.0625rem] leading-snug [overflow-wrap:anywhere]`}
    />
  )
}

/** Each box has a minimum width (the flex-basis), so on a narrow column it drops
 *  to its own line inside the card instead of being squeezed to a few
 *  characters wide - which is what made a handle unreadable at a glance. */

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
    <div className="rounded-xl border border-rule px-2 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Name only, at its original width: a glyph in this slot cut
            "Instagram" to "Insta...", and every box on this row has to show
            its whole value. */}
        <span className="w-20 shrink-0 truncate text-sm font-semibold text-text">
          {account.platform}
        </span>

        <GrowingBox
          value={account.handle ?? ''}
          onCommit={(next) => field('handle', next)}
          label={`${account.platform} handle`}
          placeholder="@handle"
          className="min-h-tap min-w-0 flex-[1_1_10rem] rounded-lg border border-edge bg-surface px-2 text-sm text-text placeholder:text-state-later focus:border-state-now/80 focus:outline-none"
        />
        <GrowingBox
          value={account.email ?? ''}
          onCommit={(next) => field('email', next)}
          label={`${account.platform} email`}
          placeholder="email"
          autoComplete="off"
          className="min-h-tap min-w-0 flex-[1_1_13rem] rounded-lg border border-edge bg-surface px-2 text-sm text-text placeholder:text-state-later focus:border-state-now/80 focus:outline-none"
        />
        {/* The password box and its Show button travel together, so Show never
            ends up stranded on a line of its own. */}
        <div className="flex min-w-0 flex-[1_1_11rem] items-start gap-1.5">
          {CAN_MASK_TEXT ? (
            <GrowingBox
              value={account.password ?? ''}
              onCommit={(next) => field('password', next)}
              label={`${account.platform} password`}
              placeholder="password"
              autoComplete="new-password"
              mask={!show}
              className="min-h-tap min-w-0 flex-1 rounded-lg border border-edge bg-surface px-2 text-sm text-text placeholder:text-state-later focus:border-state-now/80 focus:outline-none"
            />
          ) : (
            <input
              defaultValue={account.password ?? ''}
              onBlur={(event) => field('password', event.target.value)}
              type={show ? 'text' : 'password'}
              aria-label={`${account.platform} password`}
              placeholder="password"
              autoComplete="new-password"
              className="min-h-tap min-w-0 flex-1 rounded-lg border border-edge bg-surface px-2 text-sm text-text placeholder:text-state-later focus:border-state-now/80 focus:outline-none"
            />
          )}
          <button
            type="button"
            onClick={() => setShow((current) => !current)}
            className="press mt-2 shrink-0 rounded-full border border-edge px-2.5 py-1 text-xs font-semibold text-state-later active:bg-surface"
          >
            {show ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      <div className="mt-1.5 flex items-center gap-1">
        {STATUS_ORDER.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => void onPatch(account.id, { status })}
            aria-pressed={account.status === status}
            className={[
              'press rounded-full px-2.5 py-1 label',
              account.status === status
                ? 'bg-surface-raised text-state-now'
                : 'text-state-later active:bg-surface',
            ].join(' ')}
          >
            {STATUS_LABELS[status]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void onPatch(account.id, { is_active: false })}
          className="press ml-auto rounded-full px-2.5 py-1 label text-state-later active:bg-surface"
        >
          Remove
        </button>
      </div>
    </div>
  )
}
