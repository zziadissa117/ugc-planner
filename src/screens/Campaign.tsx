// The brief: what this campaign is, where it posts, and what to say.
//
// This page used to be a metadata dashboard - trial dates, aspect ratios,
// wider-topic ratios, warm-up prep notes, angle-family alternation, editing
// style, two competing sets of handles - almost none of which answers a
// question he has while making a video. It is now built around the only four
// that do (what the product is, who it is for, how it sounds, how the video is
// structured), the hooks he works from, the platforms he posts to, and the
// never-do list. Everything else is still stored and still editable, folded
// into one line at the bottom.
//
// Two columns on anything wider than a phone: he reads this on a laptop while
// filming on his phone, and a single column of full-width cards made him
// scroll past most of it.

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { AccountsEditor } from '../components/AccountsEditor'
import { EditableField } from '../components/EditableField'
import { CloseIcon, TrashIcon, UploadIcon } from '../components/icons'
import { Button, Disclosure, SectionLabel } from '../components/ui'
import { INPUT_CLASS, buttonClass } from '../components/styles'
import type {
  Campaign as CampaignRow,
  CampaignAccount,
  CampaignField,
  CampaignHook,
  CampaignRule,
} from '../data'
import {
  centsToDollarsInput,
  confirmFieldValue,
  parseCount,
  parseDollarsToCents,
  saveFieldValue,
  virtualField,
} from '../data/campaignFields'
import { GENERATION_BRIEF_KEY } from '../hooks/generateHooks'
import { useData } from '../data/useData'
import { dailyEarningsCents, formatCents, payingPlatforms } from '../money'

interface Loaded {
  campaign: CampaignRow
  fields: CampaignField[]
  rules: CampaignRule[]
  /** Needed for the money on this page: where a campaign pays per platform,
   *  what a day is worth depends on how many he can post from. */
  accounts: CampaignAccount[]
}

/** The four that actually help him make the video. Everything else the parser
 *  found is kept, and kept out of the way. */
const BRIEF_KEYS = [
  'product_facts',
  'talking_points',
  'audience',
  'tone',
  'structure',
  'notes',
] as const

const BRIEF_LABELS: Record<string, string> = {
  product_facts: 'What it is',
  // One per line. Pinned in the FILM console while he films, so it is the one
  // field here written to be read aloud from rather than read once.
  talking_points: 'Say this in the video (one per line)',
  audience: 'Who it is for',
  tone: 'How it sounds',
  structure: 'How the video goes',
  // His own, about this campaign. No document produces it and no parser writes
  // it: it is the one field here that is only ever his.
  notes: 'Notes',
}

/** Keys that are now shown somewhere better, or are gone from the app
 *  entirely, and must not reappear in the "everything else" fold. The
 *  handles and login moved onto campaign_accounts, one per platform; editing
 *  style was noise he asked to be rid of. */
const RETIRED_KEYS = [
  GENERATION_BRIEF_KEY,
  'platforms',
  'handle_tiktok',
  'handle_instagram',
  'account_email',
  'account_password',
  'editing_style',
  'pay_per_video_cents',
  ...BRIEF_KEYS,
]

export function Campaign() {
  const { campaignId } = useParams()
  const data = useData()
  const navigate = useNavigate()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [missing, setMissing] = useState(false)

  const reload = useCallback(async () => {
    if (!campaignId) return null
    const campaign = await data.getCampaign(campaignId)
    if (!campaign) return null

    const [fields, rules, accounts] = await Promise.all([
      data.listCampaignFields(campaignId),
      data.listCampaignRules(campaignId),
      data.listCampaignAccounts(campaignId),
    ])
    return { campaign, fields, rules, accounts }
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

  const { campaign, fields, rules, accounts } = loaded
  const byKey = new Map(fields.map((f) => [f.field_key, f]))
  const rest = fields
    .filter((f) => !RETIRED_KEYS.includes(f.field_key))
    .sort((a, b) => a.field_key.localeCompare(b.field_key))

  const perDay = dailyEarningsCents(campaign, accounts)

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-5">
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
            Update from a new brief
          </Link>
          <DeleteCampaign
            name={campaign.name}
            onDelete={async () => {
              await data.deleteCampaign(campaign.id)
              void navigate('/campaigns')
            }}
          />
        </div>
      </header>

      {/* The three numbers that decide what today owes and what it pays. */}
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
          label="posts/day"
          value={campaign.daily_post_quota}
          onSave={(next) => saveColumn({ daily_post_quota: next })}
        />
        <div className="ml-auto text-right">
          <p className="label text-state-later">per day</p>
          <p className="numeric mt-1 text-2xl font-semibold leading-none text-text">
            {perDay === null ? 'no rate yet' : formatCents(perDay)}
          </p>
        </div>
      </div>

      <CrossPostPay
        campaign={campaign}
        accounts={accounts}
        onToggle={(on) => saveColumn({ pays_per_platform: on })}
      />

      {campaign.brief_is_incomplete ? (
        <p className="border-l-2 border-state-waiting pl-3 text-base text-state-waiting">
          This brief looks incomplete. Some rules may be missing.
        </p>
      ) : null}

      <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
        <div className="flex flex-col gap-5">
          <div>
            <SectionLabel>The brief</SectionLabel>
            <div className="mt-2 flex flex-col divide-y divide-rule border-b border-rule">
              {BRIEF_KEYS.map((key) => (
                <EditableField
                  key={key}
                  field={byKey.get(key) ?? virtualField(campaign.id, key)}
                  label={BRIEF_LABELS[key]}
                  multiline={key === 'talking_points'}
                  onSave={(value) => saveField(key, value)}
                  onConfirm={
                    byKey.get(key)?.source === 'parsed_unreviewed'
                      ? () => confirmField(key)
                      : undefined
                  }
                />
              ))}
            </div>
          </div>

          <GenerationBrief
            value={byKey.get(GENERATION_BRIEF_KEY)?.field_value ?? ''}
            onSave={(value) => saveField(GENERATION_BRIEF_KEY, value)}
          />

          <HooksEditor campaignId={campaign.id} />
        </div>

        <div className="flex flex-col gap-5">
          <AccountsEditor data={data} campaignId={campaign.id} onChanged={() => void refresh()} />

          {rules.length > 0 ? (
            <Disclosure summary={`Never do - ${rules.length}`} tone="blocked" className="border-t">
              <ul className="flex flex-col gap-2.5">
                {rules.map((rule) => (
                  <li key={rule.id} className="border-l border-state-blocked/70 pl-3 text-base text-text">
                    {rule.body}
                  </li>
                ))}
              </ul>
            </Disclosure>
          ) : null}

          {rest.length > 0 ? (
            <Disclosure summary={`Everything else from the documents - ${rest.length}`} className="border-t">
              <div className="flex flex-col divide-y divide-rule text-sm">
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
            </Disclosure>
          ) : null}
        </div>
      </div>
    </section>
  )
}

/** A whole worked-up brief, pasted in as one document.
 *
 *  He does not write hooks by hand. He has the campaign's brief and contract
 *  read and turned into a document - product facts, audience segments, voice
 *  rules, formats, hook banks, angles - and pastes the result in here. It is
 *  stored verbatim as one field and sent to the generator whole, because the
 *  structure is the point: split into fragments it would be a pile of lines,
 *  and the generator would lose which format or segment each belonged to.
 *
 *  Deliberately NOT a list of hooks. Nothing here is ever offered to him as a
 *  line to read to camera - the FILM console shows generated hooks only, which
 *  is exactly what he asked for. */
function GenerationBrief({
  value,
  onSave,
}: {
  value: string
  onSave: (value: string | null) => Promise<void>
}) {
  const [draft, setDraft] = useState(value)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  // Held in state, not computed from `value` on every render: derived from the
  // value it would slam shut the instant he saved, hiding the confirmation he
  // was waiting for. Open to start when there is nothing in it yet, and his
  // afterwards.
  const [open, setOpen] = useState(value.trim() === '')

  const dirty = draft.trim() !== value.trim()

  return (
    <Disclosure
      summary={`Brief for the hook writer${value.trim() === '' ? '' : ' - saved'}`}
      tone="now"
      className="border-t"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <p className="meta mb-3 text-state-later">
        Paste the whole thing - product, audience, voice, structure, formats, hook banks, angles. It
        goes to the hook writer as-is and outranks the short fields above. It is never shown as a
        hook.
      </p>
      <textarea
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          setSaved(false)
        }}
        aria-label="Brief for the hook writer"
        placeholder="# Campaign brief&#10;&#10;## PRODUCT&#10;...&#10;&#10;## VOICE&#10;..."
        className={`${INPUT_CLASS} h-64 w-full resize-y py-3 font-mono text-xs`}
      />
      <Button
        onClick={() => {
          setBusy(true)
          void onSave(draft.trim() === '' ? null : draft)
            .then(() => setSaved(true))
            .finally(() => setBusy(false))
        }}
        disabled={busy || !dirty}
        className="mt-2 w-full"
      >
        {busy ? 'Saving...' : saved && !dirty ? 'Saved' : 'Save the brief'}
      </Button>
    </Disclosure>
  )
}

/** Hooks, ideas, formats - whatever he wants the generator to work from.
 *
 *  Collapsed by default: this list runs long, and it is material he reaches
 *  for while filming rather than something to read past on the way to the
 *  rest of the brief. A blank line starts a new entry, so a whole page of
 *  ideas can be pasted in at once. */
function HooksEditor({ campaignId }: { campaignId: string }) {
  const data = useData()
  const [hooks, setHooks] = useState<CampaignHook[]>([])
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setHooks(await data.listCampaignHooks(campaignId))
  }, [campaignId, data])

  useEffect(() => {
    void reload()
  }, [reload])

  async function add() {
    // Split on blank lines rather than every newline: a rough idea is often
    // several lines, and one paste should not become twelve fragments.
    const entries = body
      .split(/\n\s*\n/)
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
    if (entries.length === 0) return

    setBusy(true)
    try {
      for (const entry of entries) {
        await data.addCampaignHook({
          campaign_id: campaignId,
          angle_id: null,
          body: entry,
          outline: null,
          // His words. A model never wrote this, so it must not claim one did.
          source: 'user_entered',
          model: null,
          generated_at: null,
          used_at: null,
        })
      }
      setBody('')
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    await data.deleteCampaignHook(id)
    await reload()
  }

  return (
    <Disclosure summary={`Hooks & ideas - ${hooks.length}`} tone="now" className="border-t">
      {hooks.length > 0 ? (
        <ul className="flex flex-col divide-y divide-rule border-y border-rule">
          {hooks.map((hook) => (
            <li key={hook.id} className="flex items-start gap-2 py-2.5">
              <span
                className={`min-w-0 flex-1 whitespace-pre-wrap text-base ${
                  hook.used_at === null ? 'text-text' : 'text-state-later line-through'
                }`}
              >
                {hook.body}
                {hook.source === 'generated' ? (
                  <span className="ml-2 label text-state-later">generated</span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => void remove(hook.id)}
                aria-label={`Delete hook: ${hook.body.slice(0, 40)}`}
                className="press -my-1 flex size-9 shrink-0 items-center justify-center rounded-full text-state-later active:bg-surface"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        aria-label="Hooks and ideas"
        placeholder="Dump hooks, video ideas, formats, concepts. Blank line between each. Generate Hooks builds from these."
        className={`${INPUT_CLASS} mt-3 h-28 w-full resize-y py-3 text-base`}
      />
      <Button onClick={() => void add()} disabled={busy || body.trim() === ''} className="mt-2 w-full">
        Save to this brief
      </Button>
    </Disclosure>
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

  return (
    <button
      type="button"
      onClick={() => void onToggle(!on)}
      aria-pressed={on}
      aria-label="Each platform pays separately"
      className="press flex min-h-tap w-full items-center justify-between gap-4 border-b border-rule pb-3 text-left"
    >
      <span className="min-w-0">
        <span className={`block text-base font-semibold ${on ? 'text-state-posted' : 'text-text'}`}>
          Each platform pays separately
        </span>
        <span className="meta block text-state-later">
          {on
            ? perVideo === null
              ? `One video is paid ${paying} time${paying === 1 ? '' : 's'}, once per platform`
              : `${formatCents(perVideo)} per platform, so one video earns ${formatCents(
                  perVideo * paying,
                )} across ${paying}`
            : 'One video earns once, however many platforms it goes to'}
        </span>
      </span>
      {/* A switch, drawn: the knob travels on the settle spring. */}
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
        aria-label="Delete this campaign"
        title="Delete this campaign"
        className="press flex size-10 items-center justify-center rounded-full border border-edge text-state-later active:bg-surface"
      >
        <TrashIcon className="h-4 w-4" />
      </button>
    )
  }

  return (
    <div className="settle-in flex flex-col gap-2 border-l-2 border-state-blocked pl-3">
      <p className="text-base text-text">
        Delete {name}? It stops being owed, stops being counted, and leaves every screen.
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
          Delete it
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
