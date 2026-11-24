// A campaign, on one clean page.
//
// What it pays, its terms (pay per video, videos a day, minimum views, the
// platforms), the accounts with their logins - with the red warning while
// there are none - the product & hook ideas and the hooks written from them,
// and archiving it.
//
// Nothing here is about documents any more. Uploading a brief or a contract,
// the review of what was read, the fields still waiting to be confirmed and
// the "update from a new contract" flow are gone with the upload. What other
// screens still read - each platform paying separately, his own month, the
// payout dates, whether videos have to be submitted - is in one "More" fold,
// with his notes.

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { AccountsEditor } from '../components/AccountsEditor'
import { CampaignIdeas } from '../components/CampaignIdeas'
import { PostizChannels } from '../components/PostizChannels'
import { PlatformGlyph } from '../components/icons'
import { Button, Disclosure, ScreenHeader, SectionLabel } from '../components/ui'
import { CARD_CLASS, INPUT_CLASS, buttonClass } from '../components/styles'
import type {
  Campaign as CampaignRow,
  CampaignAccount,
  CampaignField,
  CampaignPayout,
  PayoutSchedule,
} from '../data'
import { PAYOUT_SCHEDULE_VALUES, localToday } from '../data'
import { centsToDollarsInput, parseCount, parseDollarsToCents, saveFieldValue } from '../data/campaignFields'
import { deliverableCents, paysPerPlatform } from '../data/earnings'
import { PAYOUT_SCHEDULE_LABELS, formatDay, payoutStatus } from '../data/payouts'
import { useData } from '../data/useData'
import { formatViews, parseViews } from '../data/views'
import { GENERATION_BRIEF_KEY } from '../hooks/generateHooks'
import { campaignEarnings, formatCents, hasMonthlyOverride, monthlyPayCents, payingPlatforms } from '../money'

interface Loaded {
  campaign: CampaignRow
  fields: CampaignField[]
  /** Needed for the money on this page: where a campaign pays per platform,
   *  what a day is worth depends on its accounts. */
  accounts: CampaignAccount[]
  payouts: CampaignPayout[]
}

export function Campaign() {
  const { campaignId } = useParams()
  const data = useData()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [missing, setMissing] = useState(false)

  const reload = useCallback(async () => {
    if (!campaignId) return null
    const campaign = await data.getCampaign(campaignId)
    if (!campaign) return null

    const [fields, accounts, payouts] = await Promise.all([
      data.listCampaignFields(campaignId),
      data.listCampaignAccounts(campaignId),
      data.listCampaignPayouts(campaignId),
    ])
    return { campaign, fields, accounts, payouts }
  }, [campaignId, data])

  useEffect(() => {
    let cancelled = false
    void reload().then((next) => {
      if (cancelled) return
      if (next === null) setMissing(true)
      else setLoaded(next)
    })
    return () => {
      cancelled = true
    }
  }, [reload])

  const refresh = useCallback(async () => {
    const next = await reload()
    if (next) setLoaded(next)
  }, [reload])

  /** Through the field row as well as the column, so a rate or a weekly
   *  count a contract once stated can never sit beside a different one. */
  const saveField = useCallback(
    async (fieldKey: string, value: string | null) => {
      if (!campaignId) return
      await saveFieldValue(data, campaignId, fieldKey, value)
      await refresh()
    },
    [campaignId, data, refresh],
  )

  const saveColumn = useCallback(
    async (patch: Partial<CampaignRow>) => {
      if (!campaignId) return
      await data.updateCampaign(campaignId, patch)
      await refresh()
    },
    [campaignId, data, refresh],
  )

  if (missing) {
    return (
      <section className="mx-auto flex max-w-3xl flex-col gap-4">
        <p className="text-base text-text-dim">No such campaign.</p>
        <Link to="/campaigns" className="meta text-state-later underline underline-offset-4">
          Back to campaigns
        </Link>
      </section>
    )
  }
  if (!loaded) return null

  const { campaign, fields, accounts, payouts } = loaded
  const earnings = campaignEarnings(campaign, accounts)
  const live = accounts.filter((a) => a.is_active)
  const perWeek = campaign.posts_per_week

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-9">
      <CampaignTitle name={campaign.name} onSave={(next) => saveColumn({ name: next })} />

      {/* Just restored from the archive: the Postiz channels it had switched
          off, to switch back on. */}
      {params.get('postiz') === 'restore' ? (
        <div className="flex flex-col gap-2">
          <PostizChannels campaign={campaign} mode="restore" />
          <Button size="small" variant="ghost" className="self-start" onClick={() => setParams({}, { replace: true })}>
            Done
          </Button>
        </div>
      ) : null}

      {/* The headline: what a day of it pays. */}
      <div>
        <p className="label text-state-later">Pays</p>
        {earnings === null ? (
          <p className="mt-2 text-xl text-state-later">not saved yet</p>
        ) : (
          <>
            <p className="numeric mt-2 font-semibold leading-none text-text" style={{ fontSize: 'clamp(2.75rem, 13vw, 3.75rem)' }}>
              {formatCents(earnings.dayCents)}
              <span className="ml-2 text-xl font-normal text-text-dim">a day</span>
            </p>
            <p className="numeric meta mt-3 text-state-later">
              {formatCents(earnings.weekCents)} a week · {formatCents(earnings.monthCents)} a month
            </p>
          </>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <SectionLabel>Terms</SectionLabel>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <InlineEdit
            label="Pay per video"
            display={campaign.pay_per_video_cents === null ? null : formatCents(campaign.pay_per_video_cents)}
            initial={campaign.pay_per_video_cents === null ? '' : centsToDollarsInput(campaign.pay_per_video_cents)}
            parse={parseDollarsToCents}
            allowEmpty
            inputMode="decimal"
            invalid="Enter an amount like 35 or 35.50."
            onSave={(cents) => saveField('pay_per_video_cents', cents === null ? null : String(cents))}
          />
          {/* Stored as a week (posts_per_week = a day x 7); asked and shown
              as a day. A week that is not a whole number of days - a deal
              written as five a week - is shown as it is. */}
          <InlineEdit
            label="Videos a day"
            display={perWeek === 0 ? null : perWeek % 7 === 0 ? String(perWeek / 7) : `${perWeek} a week`}
            initial={perWeek > 0 && perWeek % 7 === 0 ? String(perWeek / 7) : ''}
            parse={(raw) => {
              const n = parseCount(raw)
              return n === null || n < 1 ? null : n
            }}
            inputMode="numeric"
            invalid="Enter a whole number of videos a day."
            onSave={(perDay) => saveField('posts_per_week', String((perDay ?? 0) * 7))}
          />
          <InlineEdit
            label="Minimum views"
            display={campaign.min_views == null ? 'none' : formatViews(campaign.min_views)}
            initial={campaign.min_views == null ? '' : String(campaign.min_views)}
            parse={parseViews}
            allowEmpty
            inputMode="numeric"
            invalid="Enter a number of views, like 1000 or 1k - or leave it empty for none."
            onSave={(views) => saveColumn({ min_views: views })}
          />
          <div className={`${CARD_CLASS} flex min-w-0 flex-col gap-2 px-4 py-3`}>
            <span className="label text-state-later">Platforms</span>
            {live.length === 0 ? (
              <span className="text-base text-state-later">none yet</span>
            ) : (
              <span role="img" aria-label={live.map((a) => a.platform).join(', ')} className="flex flex-wrap gap-2.5 text-text">
                {live.map((a) => (
                  <PlatformGlyph key={a.id} platform={a.platform} className="h-6 w-6" />
                ))}
              </span>
            )}
          </div>
        </div>
      </div>

      <AccountsEditor data={data} campaignId={campaign.id} onChanged={() => void refresh()} />

      <CampaignIdeas
        campaign={campaign}
        ideasField={fields.find((f) => f.field_key === GENERATION_BRIEF_KEY)}
        onChanged={refresh}
      />

      {/* Set once, read by the Post screen and the money: one fold. */}
      <Disclosure summary="More" trailing="payouts, notes">
        <div className="flex flex-col gap-5 pt-1">
          <CrossPostPay
            campaign={campaign}
            accounts={accounts}
            onToggle={(on) => saveColumn({ pays_per_platform: on })}
          />

          <MonthlyPay
            campaign={campaign}
            accounts={accounts}
            onSave={(cents) => saveColumn({ monthly_pay_override_cents: cents })}
          />

          <PayoutSection
            campaign={campaign}
            payouts={payouts}
            onSave={saveColumn}
            onMarkPaid={async (dueDate) => {
              await data.markPayoutPaid(campaign.id, dueDate)
              await refresh()
            }}
            onMarkPending={async (dueDate) => {
              await data.unmarkPayoutPaid(campaign.id, dueDate)
              await refresh()
            }}
          />

          <SwitchRow
            on={campaign.needs_submission}
            label="Videos need to be submitted"
            detail={
              campaign.needs_submission
                ? 'Ticking a post asks whether you submitted it'
                : 'Ticking a post is all this campaign needs'
            }
            onToggle={(on) => saveColumn({ needs_submission: on })}
          />

          <Notes
            key={fields.find((f) => f.field_key === 'notes')?.updated_at ?? 'none'}
            value={fields.find((f) => f.field_key === 'notes')?.field_value ?? ''}
            onSave={(value) => saveField('notes', value)}
          />
        </div>
      </Disclosure>

      <ArchiveCampaign
        name={campaign.name}
        onArchive={async () => {
          await data.archiveCampaign(campaign.id)
          // A campaign the cutter posts still holds its Postiz channels:
          // land on the list that says which to switch off.
          void navigate(campaign.cutter_campaign_id ? `/campaigns/archived?free=${campaign.id}` : '/campaigns')
        }}
      />
    </section>
  )
}

/** The campaign's name as the screen's title, renamed in place.
 *
 *  A name is his label for the work, so it goes straight to the column. An
 *  empty name is refused rather than saved: every screen finds a campaign by
 *  its name, and a blank one is unfindable. */
function CampaignTitle({ name, onSave }: { name: string; onSave: (next: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [busy, setBusy] = useState(false)

  async function save() {
    const cleaned = draft.trim()
    if (cleaned === '') return
    setBusy(true)
    try {
      if (cleaned !== name) await onSave(cleaned)
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2">
        <p className="kicker">Campaign</p>
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save()
              if (event.key === 'Escape') setEditing(false)
            }}
            aria-label="Campaign name"
            autoFocus
            className={`${INPUT_CLASS} min-w-0 flex-1 text-xl font-semibold`}
          />
          <Button variant="now" size="small" onClick={() => void save()} disabled={busy || draft.trim() === ''}>
            Save
          </Button>
        </div>
      </div>
    )
  }

  // Still a real heading: it is what every screen and every test finds the
  // campaign by, and making it editable must not cost it that.
  return (
    <ScreenHeader
      kicker="Campaign"
      title={
        <button
          type="button"
          aria-label={`Rename ${name}`}
          onClick={() => {
            setDraft(name)
            setEditing(true)
          }}
          className="press max-w-full break-words rounded-md text-left"
        >
          {name}
        </button>
      }
      aside={
        <Link to="/campaigns" className={buttonClass('ghost', 'small')}>
          All campaigns
        </Link>
      }
    />
  )
}

/** One term of the deal, as a card that turns into a box when tapped.
 *
 *  A visible edge, because this used to be borderless text and the one
 *  control he most needed (the rate) read as a label - "doesn't even let me
 *  set a per post rate". A value nobody has typed reads "not saved yet". */
function InlineEdit({
  label,
  display,
  initial,
  parse,
  invalid,
  onSave,
  allowEmpty = false,
  inputMode,
}: {
  label: string
  /** What the card shows; null for "not saved yet". */
  display: ReactNode | null
  initial: string
  parse: (raw: string) => number | null
  invalid: string
  onSave: (value: number | null) => Promise<void>
  /** Whether an empty box saves as "none" rather than being refused. */
  allowEmpty?: boolean
  inputMode: 'decimal' | 'numeric'
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    const empty = draft.trim() === ''
    const parsed = empty ? null : parse(draft)
    if ((parsed === null && !empty) || (empty && !allowEmpty)) {
      setError(invalid)
      return
    }
    setBusy(true)
    try {
      await onSave(parsed)
      setEditing(false)
      setError(null)
    } catch (caught) {
      // Never leave the box open with nothing said: an unsaved edit that gives
      // no reason reads as a Save button that does not work.
      setError(caught instanceof Error ? caught.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className={`${CARD_CLASS} flex min-w-0 flex-col gap-2 !border-brand/60 px-3 py-3`}>
        <span className="label text-state-later">{label}</span>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          // Select what is there, so typing replaces it. Without this the
          // box opened as "35.00" with the cursor after it, and typing 40
          // made "35.0040" - not an amount, so Save refused it.
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save()
            if (event.key === 'Escape') setEditing(false)
          }}
          aria-label={label}
          inputMode={inputMode}
          autoFocus
          className={`${INPUT_CLASS} !min-h-11 w-full min-w-0 text-base`}
        />
        <div className="flex gap-2">
          <Button variant="now" size="small" onClick={() => void save()} disabled={busy} className="flex-1 !px-3">
            Save
          </Button>
          <Button variant="ghost" size="small" onClick={() => setEditing(false)} className="!px-3">
            Cancel
          </Button>
        </div>
        {error ? (
          <span role="alert" className="meta text-state-blocked">
            {error}
          </span>
        ) : null}
      </div>
    )
  }

  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        setDraft(initial)
        setError(null)
        setEditing(true)
      }}
      className={`${CARD_CLASS} press flex min-w-0 flex-col gap-2 px-4 py-3 text-left transition-colors duration-200 hover:border-edge-lit`}
    >
      <span className="label text-state-later">{label}</span>
      {display === null ? (
        <span className="text-base text-state-later">not saved yet</span>
      ) : (
        <span className="numeric break-words text-xl font-semibold leading-tight text-text">{display}</span>
      )}
    </button>
  )
}

/** Whether each platform is paid separately for the same video.
 *
 *  Off by default and off for almost every campaign: one video cross-posted
 *  everywhere is one deliverable earning once, and deriving pay from the
 *  account list is what once showed him "$105/day" for a campaign paying $35.
 *  Some contracts really do pay per platform, and nothing in the data can
 *  tell the two apart - so he sets it, and the app never infers it. It
 *  changes what a deliverable earns and nothing else. */
function CrossPostPay({
  campaign,
  accounts,
  onToggle,
}: {
  campaign: CampaignRow
  accounts: readonly CampaignAccount[]
  onToggle: (on: boolean) => Promise<void>
}) {
  const on = campaign.pays_per_platform
  const paying = payingPlatforms(campaign, accounts)
  const perVideo = campaign.pay_per_video_cents
  // He gave a platform a rate of its own: the campaign pays per platform
  // whether or not this switch is on, and the switch cannot turn that off.
  const ownRates = accounts.some(
    (a) => a.campaign_id === campaign.id && a.is_active && a.pay_per_post_cents != null,
  )
  const separate = paysPerPlatform(campaign, accounts)
  const total = deliverableCents(campaign, accounts)

  const detail = ownRates
    ? total === null
      ? 'Some platforms have a rate of their own, so each is paid separately'
      : `Platforms with a rate of their own pay it; one video earns ${formatCents(total)} across ${paying}`
    : on
      ? perVideo === null
        ? `One video is paid ${paying} time${paying === 1 ? '' : 's'}, once per platform`
        : `${formatCents(perVideo)} per platform, so one video earns ${formatCents(perVideo * paying)} across ${paying}`
      : 'One video earns once, however many platforms it goes to'

  return (
    <SwitchRow
      on={separate}
      label="Each platform pays separately"
      detail={detail}
      onToggle={ownRates ? async () => undefined : onToggle}
    />
  )
}

/** A campaign setting he turns on and off: the label, a line saying what it
 *  does, and a drawn switch whose knob travels on the settle spring. */
function SwitchRow({
  on,
  label,
  detail,
  onToggle,
}: {
  on: boolean
  label: string
  detail: string
  onToggle: (on: boolean) => Promise<void>
}) {
  return (
    <button
      type="button"
      onClick={() => void onToggle(!on)}
      aria-pressed={on}
      aria-label={label}
      className="press flex min-h-tap w-full items-center justify-between gap-4 border-b border-rule pb-4 text-left"
    >
      <span className="min-w-0">
        <span className="block text-base font-semibold text-text">{label}</span>
        <span className="meta block text-state-later">{detail}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className={`label ${on ? 'text-text' : 'text-state-later'}`}>{on ? 'On' : 'Off'}</span>
        <span
          aria-hidden
          className={`relative h-7 w-12 rounded-full border transition-colors duration-300 ${
            on ? 'border-white/20 bg-[linear-gradient(135deg,#6585F5_0%,#1D40C2_100%)]' : 'border-edge bg-surface'
          }`}
        >
          <span
            className={`absolute top-1/2 size-5 -translate-y-1/2 rounded-full transition-[left,background-color] duration-[var(--dur-settle)] [transition-timing-function:var(--ease-settle)] ${
              on ? 'left-[1.45rem] bg-white' : 'left-0.5 bg-state-later'
            }`}
          />
        </span>
      </span>
    </button>
  )
}

/** The month, and a way to correct it.
 *
 *  For a deal no per-video rate can express - a retainer, or pay per
 *  completed cycle. An estimate carries a "~" and says so; his own number does
 *  not. Clearing it puts the estimate back rather than storing a zero - a
 *  campaign he has un-corrected is not one paying nothing. */
function MonthlyPay({
  campaign,
  accounts,
  onSave,
}: {
  campaign: CampaignRow
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

  return (
    <div className="flex flex-col gap-2 border-b border-rule pb-4">
      <span className="text-base font-semibold text-text">Pay per month</span>
      {editing ? (
        <span className="flex flex-wrap items-center gap-2">
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
            className={`${INPUT_CLASS} !min-h-11 w-36 text-base`}
          />
          <Button variant="now" size="small" onClick={() => void save()} disabled={busy}>
            Save
          </Button>
          {mine ? (
            <Button variant="ghost" size="small" onClick={() => void commit(null)} disabled={busy}>
              Reset
            </Button>
          ) : null}
          {error ? <span className="meta basis-full text-state-blocked">{error}</span> : null}
        </span>
      ) : (
        <button
          type="button"
          aria-label={`Pay per month for ${campaign.name}`}
          onClick={() => {
            setDraft(monthly === null || !mine ? '' : centsToDollarsInput(monthly))
            setEditing(true)
          }}
          className="press meta self-start whitespace-nowrap rounded text-left tabular-nums text-state-later underline decoration-edge-lit decoration-dotted underline-offset-4 hover:text-text"
        >
          {monthly === null
            ? 'tap to set pay per month'
            : `${mine ? '' : '~'}${formatCents(monthly)}/mo · ${mine ? 'your figure' : 'estimate'}`}
        </button>
      )}
    </div>
  )
}

/** When the brand pays, and whether the latest payout has arrived.
 *
 *  One-off or recurring from a first date he picks. Whether a given payout has
 *  been received is its own record per due date, so ticking this month's off
 *  leaves next month's pending. Nothing is guessed: with no date saved the
 *  section says so and shows no status. */
function PayoutSection({
  campaign,
  payouts,
  onSave,
  onMarkPaid,
  onMarkPending,
}: {
  campaign: CampaignRow
  payouts: readonly CampaignPayout[]
  onSave: (patch: Partial<CampaignRow>) => Promise<void>
  onMarkPaid: (dueDate: string) => Promise<void>
  onMarkPending: (dueDate: string) => Promise<void>
}) {
  const today = localToday()
  const status = payoutStatus(campaign, payouts, today)
  const latest = status?.latest ?? null

  return (
    <div className="flex flex-col gap-3 border-b border-rule pb-4">
      <span className="text-base font-semibold text-text">Payout</span>
      <div role="group" aria-label="Payout schedule" className="flex flex-wrap items-center gap-2">
        {PAYOUT_SCHEDULE_VALUES.map((schedule: PayoutSchedule) => {
          const on = campaign.payout_schedule === schedule
          return (
            <button
              key={schedule}
              type="button"
              aria-pressed={on}
              onClick={() =>
                void onSave({
                  payout_schedule: schedule,
                  // "None" forgets the date too, so a campaign with no
                  // schedule is not left holding a date that means nothing.
                  ...(schedule === 'none' ? { payout_date: null } : {}),
                })
              }
              className={[
                'press min-h-10 rounded-full border px-4 text-sm font-semibold transition-colors duration-200',
                on ? 'border-brand/70 bg-brand/10 text-text' : 'border-edge text-state-later hover:text-text',
              ].join(' ')}
            >
              {PAYOUT_SCHEDULE_LABELS[schedule]}
            </button>
          )
        })}
      </div>
      {campaign.payout_schedule === 'none' ? null : (
        <label className="flex items-center gap-2">
          <span className="label text-state-later">{campaign.payout_schedule === 'one_off' ? 'On' : 'First'}</span>
          <input
            type="date"
            aria-label="Payout date"
            value={campaign.payout_date ?? ''}
            onChange={(event) => void onSave({ payout_date: event.target.value || null })}
            className={`${INPUT_CLASS} !min-h-11 w-44 text-sm`}
          />
        </label>
      )}

      {campaign.payout_schedule !== 'none' && campaign.payout_date === null ? (
        <p className="meta text-state-later">Pick the date it pays - not saved yet.</p>
      ) : null}

      {status === null ? null : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {latest ? (
            <>
              <span
                className={`text-base font-semibold ${
                  latest.paid ? 'text-state-posted' : status.overdue ? 'text-state-waiting' : 'text-state-later'
                }`}
              >
                {formatDay(latest.dueDate)} - {latest.paid ? 'paid' : 'pending'}
              </span>
              <Button
                size="small"
                onClick={() => void (latest.paid ? onMarkPending(latest.dueDate) : onMarkPaid(latest.dueDate))}
              >
                {latest.paid ? 'Mark pending' : 'Mark paid'}
              </Button>
            </>
          ) : null}
          {status.next ? <span className="meta text-state-later">Next {formatDay(status.next)}</span> : null}
        </div>
      )}
    </div>
  )
}

/** His own notes on the campaign. No document produces them. */
function Notes({ value, onSave }: { value: string; onSave: (value: string | null) => Promise<void> }) {
  const [draft, setDraft] = useState(value)
  const [busy, setBusy] = useState(false)
  const dirty = draft.trim() !== value.trim()

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="campaign-notes" className="text-base font-semibold text-text">
        Notes
      </label>
      <textarea
        id="campaign-notes"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className={`${INPUT_CLASS} min-h-24 w-full resize-y py-3 text-base`}
      />
      <Button
        size="small"
        variant={dirty ? 'now' : 'quiet'}
        className="self-start"
        disabled={busy || !dirty}
        onClick={() => {
          setBusy(true)
          void onSave(draft.trim() === '' ? null : draft).finally(() => setBusy(false))
        }}
      >
        Save notes
      </Button>
    </div>
  )
}

/** Archiving: one button at the foot of the page, and one confirming tap.
 *
 *  Two taps because it takes the campaign off every screen at once - what it
 *  owes, the money, the Post board - and the second names it, so a mis-tap on
 *  the wrong campaign cannot do it silently. Nothing is destroyed underneath:
 *  the campaign is marked archived and its videos and their history stay. */
function ArchiveCampaign({ name, onArchive }: { name: string; onArchive: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!confirming) {
    return (
      <div className="border-t border-rule pt-6">
        <Button variant="quiet" size="small" onClick={() => setConfirming(true)}>
          Archive campaign
        </Button>
      </div>
    )
  }

  return (
    <div className="settle-in flex flex-col gap-3 border-t border-rule pt-6">
      <p className="text-base text-text">
        Archive {name}? It stops being owed and counted, and leaves every screen. You can bring it back from
        Archived on Campaigns.
      </p>
      <div className="flex gap-2">
        <Button onClick={() => setConfirming(false)} className="flex-1">
          Keep it
        </Button>
        <Button
          variant="blocked"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void onArchive().finally(() => setBusy(false))
          }}
          className="flex-1"
        >
          Archive it
        </Button>
      </div>
    </div>
  )
}
