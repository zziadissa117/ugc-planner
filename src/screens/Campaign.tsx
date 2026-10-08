// A campaign: what it pays, and the accounts it posts from.
//
// "I don't even use the brief section at all... All I need is to know the
// account logins." So the page is now three things: the two numbers that set
// the pay (per post, posts a week), the accounts with their logins - big, with
// Copy buttons - and one folded "More" holding everything else that other
// screens still read (pay per platform, payout dates, submission, the cutter
// link, the never-do list, notes, and what the documents said).
//
// The creative brief and hook ideas moved to the FILM console, where hooks are
// written. The brief fields the contract reader fills (what it is, who it's
// for, how it sounds...) are still stored - FILM shows them - and sit in the
// "More" fold here.

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { AccountsEditor } from '../components/AccountsEditor'
import { EditableField } from '../components/EditableField'
import { PostizChannels } from '../components/PostizChannels'
import { TrashIcon, UploadIcon } from '../components/icons'
import { Button, Disclosure, SectionLabel } from '../components/ui'
import { INPUT_CLASS, buttonClass } from '../components/styles'
import type {
  Campaign as CampaignRow,
  CampaignAccount,
  CampaignField,
  CampaignPayout,
  CampaignRule,
  PayoutSchedule,
} from '../data'
import { PAYOUT_SCHEDULE_VALUES } from '../data'
import { listCutterCampaigns, type CutterCampaign } from '../sync/cutterBridge'
import { deliverableCents, paysPerPlatform } from '../data/earnings'
import { PAYOUT_SCHEDULE_LABELS, payoutStatus } from '../data/payouts'
import {
  centsToDollarsInput,
  confirmFieldValue,
  parseCount,
  parseDollarsToCents,
  saveFieldValue,
  virtualField,
} from '../data/campaignFields'
import { GENERATION_BRIEF_KEY } from '../hooks/generateHooks'
import { localToday } from '../data'
import { formatDay } from '../data/payouts'
import { useData } from '../data/useData'
import { campaignEarnings, formatCents, payingPlatforms } from '../money'

interface Loaded {
  campaign: CampaignRow
  fields: CampaignField[]
  rules: CampaignRule[]
  /** Needed for the money on this page: where a campaign pays per platform,
   *  what a day is worth depends on how many he can post from. */
  accounts: CampaignAccount[]
  payouts: CampaignPayout[]
}

/** Keys that are shown somewhere better, or are gone from the app entirely,
 *  and must not reappear in the "what the documents said" list. The handles
 *  and login live on campaign_accounts, one per platform; the creative brief
 *  lives in FILM; the rate is the pay line; notes have their own box. */
const RETIRED_KEYS = [
  GENERATION_BRIEF_KEY,
  'platforms',
  'handle_tiktok',
  'handle_instagram',
  'account_email',
  'account_password',
  'editing_style',
  'pay_per_video_cents',
  'notes',
]

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

    const [fields, rules, accounts, payouts] = await Promise.all([
      data.listCampaignFields(campaignId),
      data.listCampaignRules(campaignId),
      data.listCampaignAccounts(campaignId),
      data.listCampaignPayouts(campaignId),
    ])
    return { campaign, fields, rules, accounts, payouts }
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

  const saveField = useCallback(
    async (fieldKey: string, value: string | null) => {
      if (!campaignId) return
      await saveFieldValue(data, campaignId, fieldKey, value)
      await refresh()
    },
    [campaignId, data, refresh],
  )

  const confirmField = useCallback(
    async (fieldKey: string) => {
      if (!campaignId) return
      await confirmFieldValue(data, campaignId, fieldKey)
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

  if (missing) return <p className="text-state-later">No such campaign.</p>
  if (!loaded) return null

  const { campaign, fields, rules, accounts, payouts } = loaded
  const byKey = new Map(fields.map((f) => [f.field_key, f]))
  const rest = fields
    .filter((f) => !RETIRED_KEYS.includes(f.field_key))
    .sort((a, b) => a.field_key.localeCompare(b.field_key))

  const earnings = campaignEarnings(campaign, accounts)

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-7">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <CampaignTitle
            name={campaign.name}
            onSave={(next) => saveColumn({ name: next })}
          />
          {campaign.company ? (
            <p className="meta mt-1 text-state-later">{campaign.company}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link to={`/campaigns/${campaign.id}/update`} className={buttonClass('quiet', 'small')}>
            <UploadIcon className="h-4 w-4" />
            Update from a new contract
          </Link>
          <DeleteCampaign
            name={campaign.name}
            onDelete={async () => {
              await data.archiveCampaign(campaign.id)
              // A campaign the cutter posts still holds its Postiz channels:
              // land on the list that says which to switch off.
              void navigate(campaign.cutter_campaign_id ? `/campaigns/archived?free=${campaign.id}` : '/campaigns')
            }}
          />
        </div>
      </header>

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

      {/* The pay: two numbers, and what they come to. */}
      <div className="flex flex-wrap items-center gap-2 border-y border-rule py-3">
        {/* Through the field row rather than straight at the column: the
            provenance row and the column the app plans against have to move
            together, or the screen ends up showing a confirmed rate beside
            "not saved yet". */}
        <Money
          label="per post"
          cents={campaign.pay_per_video_cents}
          onSave={(cents) =>
            saveField('pay_per_video_cents', cents === null ? null : String(cents))
          }
        />
        <Count
          label="posts/week"
          value={campaign.posts_per_week}
          onSave={(next) => saveColumn({ posts_per_week: next })}
        />
        {/* The same figures as the Money screen, monthly override and all. */}
        <div className="ml-auto text-right">
          <p className="label text-state-later">per week</p>
          <p className="numeric mt-1 text-2xl font-semibold leading-none text-text">
            {earnings === null ? 'no rate yet' : formatCents(earnings.weekCents)}
          </p>
          {earnings === null ? null : (
            <p className="meta mt-1 text-state-later">about {formatCents(earnings.dayCents)} a day</p>
          )}
        </div>
      </div>

      <AccountsEditor data={data} campaignId={campaign.id} onChanged={() => void refresh()} />

      {/* Everything else: set once, read by other screens, not needed day to
          day. One fold. */}
      <Disclosure summary="More" trailing="pay per platform, payouts, rules, notes" className="border-t">
        <div className="flex flex-col gap-5">
          {campaign.brief_is_incomplete ? (
            <p className="border-l-2 border-state-waiting pl-3 text-base text-state-waiting">
              The documents looked incomplete when they were read. Some rules may be missing.
            </p>
          ) : null}

          <CrossPostPay
            campaign={campaign}
            accounts={accounts}
            onToggle={(on) => saveColumn({ pays_per_platform: on })}
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

          <CutterLink campaign={campaign} onSave={saveColumn} />

          {rules.length > 0 ? (
            <div>
              <SectionLabel as="h3" tone="blocked">{`Never do - ${rules.length}`}</SectionLabel>
              <ul className="mt-2 flex flex-col gap-2.5">
                {rules.map((rule) => (
                  <li key={rule.id} className="border-l border-state-blocked/70 pl-3 text-base text-text">
                    {rule.body}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* His own, about this campaign. No document produces it. */}
          <div className="border-b border-rule">
            <EditableField
              field={byKey.get('notes') ?? virtualField(campaign.id, 'notes')}
              label="Notes"
              multiline
              onSave={(value) => saveField('notes', value)}
            />
          </div>

          {rest.length > 0 ? (
            <div>
              <SectionLabel as="h3">{`What the documents said - ${rest.length}`}</SectionLabel>
              <div className="mt-2 flex flex-col divide-y divide-rule text-sm">
                {rest.map((field) => (
                  <EditableField
                    key={field.id}
                    field={field}
                    onSave={(value) => saveField(field.field_key, value)}
                    onConfirm={
                      field.source === 'parsed_unreviewed'
                        ? () => confirmField(field.field_key)
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Disclosure>
    </section>
  )
}

/** Whether each platform is paid separately for the same video.
 *
 *  Off by default and off for almost every campaign: one video cross-posted
 *  everywhere is one deliverable earning once, and deriving pay from the
 *  account list is what once showed him "$105/day" for a campaign paying $35.
 *
 *  But some contracts really do pay per platform - "pump.fun pay lets say 16$
 *  per post and it includes cross posting. So if i post the same video to ig
 *  and tiktok and yt its seperately 16$" - and nothing in the data can tell
 *  the two apart. So the campaign carries the answer, he sets it, and the app
 *  never infers it.
 *
 *  It changes what a deliverable EARNS and nothing else: the day still owes
 *  the same number of videos and the Post grid still shows one column each. */
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
      className="press flex min-h-tap w-full items-center justify-between gap-4 border-b border-rule pb-3 text-left"
    >
      <span className="min-w-0">
        <span className={`block text-base font-semibold ${on ? 'text-state-posted' : 'text-text'}`}>{label}</span>
        <span className="meta block text-state-later">{detail}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className={`label ${on ? 'text-state-posted' : 'text-state-later'}`}>{on ? 'On' : 'Off'}</span>
        <span
          aria-hidden
          className={`relative h-7 w-12 rounded-full border transition-colors duration-300 ${
            on ? 'border-state-posted/70 bg-state-posted/20' : 'border-edge bg-surface'
          }`}
        >
          <span
            className={`absolute top-1/2 size-5 -translate-y-1/2 rounded-full transition-[left,background-color] duration-[var(--dur-settle)] [transition-timing-function:var(--ease-settle)] ${
              on ? 'left-[1.45rem] bg-state-posted' : 'left-0.5 bg-state-later'
            }`}
          />
        </span>
      </span>
    </button>
  )
}

/** When the brand pays, and whether the latest payout has arrived.
 *
 *  One-off or recurring from a first date he picks. Whether a given payout has
 *  been received is its own record per due date, so ticking this month's off
 *  leaves next month's pending. Nothing is guessed: with no date saved the
 *  section says so and shows no status. */
/** Links this campaign to the cutter's, so a video the cutter posts ticks the
 *  Post grid by itself. Only shown to the user the bridge is enabled for. */
function CutterLink({ campaign, onSave }: { campaign: CampaignRow; onSave: (patch: Partial<CampaignRow>) => Promise<void> }) {
  const [options, setOptions] = useState<CutterCampaign[] | null>(null)
  useEffect(() => {
    let cancelled = false
    void listCutterCampaigns()
      .then((list) => !cancelled && setOptions(list))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  if (options === null) return null
  return (
    <label className="flex flex-col gap-1 border-b border-rule pb-3">
      <span className="label text-state-later">Posted by the cutter</span>
      <select
        className={INPUT_CLASS}
        value={campaign.cutter_campaign_id ?? ''}
        onChange={(e) => void onSave({ cutter_campaign_id: e.target.value || null })}
      >
        <option value="">Not linked - I tick it myself</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <span className="meta text-state-later">
        {campaign.cutter_campaign_id
          ? 'Videos the cutter posts tick this campaign\'s Post boxes by themselves.'
          : 'Link it and the Post boxes tick themselves when the cutter posts.'}
      </span>
    </label>
  )
}

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
    <div className="flex flex-col gap-2 border-b border-rule pb-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="label text-state-later">Payout</span>
        <div role="group" aria-label="Payout schedule" className="flex flex-wrap items-center gap-1">
          {PAYOUT_SCHEDULE_VALUES.map((schedule: PayoutSchedule) => (
            <button
              key={schedule}
              type="button"
              aria-pressed={campaign.payout_schedule === schedule}
              onClick={() =>
                void onSave({
                  payout_schedule: schedule,
                  // "None" forgets the date too, so a campaign with no
                  // schedule is not left holding a date that means nothing.
                  ...(schedule === 'none' ? { payout_date: null } : {}),
                })
              }
              className={[
                'press rounded-full px-2.5 py-1 label',
                campaign.payout_schedule === schedule
                  ? 'bg-surface-raised text-state-now'
                  : 'text-state-later active:bg-surface',
              ].join(' ')}
            >
              {PAYOUT_SCHEDULE_LABELS[schedule]}
            </button>
          ))}
        </div>
        {campaign.payout_schedule === 'none' ? null : (
          <label className="flex items-center gap-1.5">
            <span className="label text-state-later">
              {campaign.payout_schedule === 'one_off' ? 'On' : 'First'}
            </span>
            <input
              type="date"
              aria-label="Payout date"
              value={campaign.payout_date ?? ''}
              onChange={(event) => void onSave({ payout_date: event.target.value || null })}
              className={`${INPUT_CLASS} !min-h-9 w-40 py-1 text-sm`}
            />
          </label>
        )}
      </div>

      {campaign.payout_schedule !== 'none' && campaign.payout_date === null ? (
        <p className="meta text-state-later">Pick the date it pays - not saved yet.</p>
      ) : null}

      {status === null ? null : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {latest ? (
            <>
              <span
                className={`text-base font-semibold ${
                  latest.paid ? 'text-state-posted' : status.overdue ? 'text-state-waiting' : 'text-state-later'
                }`}
              >
                {formatDay(latest.dueDate)} - {latest.paid ? 'paid' : 'pending'}
              </span>
              <button
                type="button"
                onClick={() =>
                  void (latest.paid ? onMarkPending(latest.dueDate) : onMarkPaid(latest.dueDate))
                }
                className={buttonClass('quiet', 'small')}
              >
                {latest.paid ? 'Mark pending' : 'Mark paid'}
              </button>
            </>
          ) : null}
          {status.next ? (
            <span className="meta text-state-later">Next {formatDay(status.next)}</span>
          ) : null}
        </div>
      )}
    </div>
  )
}

/** The campaign's name, renamed in place.
 *
 *  A name is his label for the work, not a claim about a document, so it goes
 *  straight to the column with no provenance row behind it - the same as the
 *  daily quota. An empty name is refused rather than saved: every screen finds
 *  a campaign by its name, and a blank one is unfindable. */
function CampaignTitle({
  name,
  onSave,
}: {
  name: string
  onSave: (next: string) => Promise<void>
}) {
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
    )
  }

  // Still a real heading: it is what every screen and every test finds the
  // campaign by, and making it editable must not cost it that.
  return (
    <h1 className="script min-w-0 text-4xl text-text">
      <button
        type="button"
        aria-label={`Rename ${name}`}
        onClick={() => {
          setDraft(name)
          setEditing(true)
        }}
        className="press max-w-full break-words rounded-md text-left active:bg-surface"
      >
        {name}
      </button>
    </h1>
  )
}

/** Removing a campaign: a bin in the header, and one confirming tap.
 *
 *  Small and grey at rest, beside the other thing you do to a whole campaign,
 *  because it is not an action he is looking for. Two taps rather than one
 *  because it takes the campaign off every screen at once - today's
 *  obligation, the money, the posting board - and the second tap names it, so
 *  a mis-tap on the wrong brief cannot do it silently. Nothing is destroyed
 *  underneath: the campaign is marked inactive and its videos and their
 *  history stay exactly as they were. */
function DeleteCampaign({ name, onDelete }: { name: string; onDelete: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label="Archive this campaign"
        title="Archive this campaign"
        className="press flex size-10 items-center justify-center rounded-full border border-edge text-state-later active:bg-surface"
      >
        <TrashIcon className="h-4 w-4" />
      </button>
    )
  }

  return (
    <div className="settle-in flex flex-col gap-2 border-l-2 border-state-blocked pl-3">
      <p className="text-base text-text">
        Archive {name}? It stops being owed, stops being counted, and leaves every screen. You can restore it from Archived on the Briefs page.
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
            void onDelete().finally(() => setBusy(false))
          }}
          className="flex-1"
        >
          Archive it
        </Button>
      </div>
    </div>
  )
}

/** A money figure on the campaign row, edited in place. */
function Money({
  label,
  cents,
  onSave,
}: {
  label: string
  cents: number | null
  onSave: (cents: number | null) => Promise<void>
}) {
  return (
    <InlineEdit
      label={label}
      // A verb, not a status. "not set" beside a greyed figure read as
      // something the app had decided; "Tap to set" says it is his to fill in.
      display={cents === null ? 'Tap to set' : formatCents(cents)}
      initial={cents === null ? '' : centsToDollarsInput(cents)}
      parse={(raw) => (raw.trim() === '' ? null : parseDollarsToCents(raw))}
      invalid="Enter an amount like 35 or 35.00."
      onSave={onSave}
    />
  )
}

/** A whole count on the campaign row, edited in place. */
function Count({
  label,
  value,
  onSave,
}: {
  label: string
  value: number
  onSave: (next: number) => Promise<void>
}) {
  return (
    <InlineEdit
      label={label}
      display={String(value)}
      initial={String(value)}
      parse={(raw) => parseCount(raw)}
      invalid="Enter a whole number."
      onSave={(next) => onSave(next ?? 0)}
    />
  )
}

function InlineEdit({
  label,
  display,
  initial,
  parse,
  invalid,
  onSave,
}: {
  label: string
  display: string
  initial: string
  parse: (raw: string) => number | null
  invalid: string
  onSave: (value: number | null) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    const parsed = parse(draft)
    if (parsed === null && draft.trim() !== '') {
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
      <span className="inline-flex flex-col items-start gap-1">
        <span className="inline-flex items-center gap-1">
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
            inputMode="decimal"
            autoFocus
            className={`${INPUT_CLASS} w-24 border-state-now/80 text-base`}
          />
          <Button variant="now" size="small" onClick={() => void save()} disabled={busy}>
            Save
          </Button>
        </span>
        {error ? (
          <span role="alert" className="meta text-state-blocked">
            {error}
          </span>
        ) : null}
      </span>
    )
  }

  // A visible box, because this used to be borderless text sitting in a strip
  // beside a figure that really is only a readout - so the one control on the
  // row that he most needs (the rate) read as a label saying "not set", and he
  // reported that the app "doesn't even let me set a per post rate".
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        setDraft(initial)
        setEditing(true)
      }}
      className="press rounded-xl border border-edge px-3 py-2 text-left hover:border-edge-lit active:bg-surface"
    >
      <span className="block label text-state-later">{label}</span>
      <span className="numeric mt-1 block text-lg font-semibold leading-none text-text">{display}</span>
    </button>
  )
}
