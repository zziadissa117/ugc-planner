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
import { Link, useParams } from 'react-router-dom'

import { AccountsEditor } from '../components/AccountsEditor'
import { EditableField } from '../components/EditableField'
import type {
  Campaign as CampaignRow,
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
import { useData } from '../data/useData'
import { dailyEarningsCents, formatCents } from '../money'

interface Loaded {
  campaign: CampaignRow
  fields: CampaignField[]
  rules: CampaignRule[]
}

/** The four that actually help him make the video. Everything else the parser
 *  found is kept, and kept out of the way. */
const BRIEF_KEYS = ['product_facts', 'audience', 'tone', 'structure'] as const

const BRIEF_LABELS: Record<string, string> = {
  product_facts: 'What it is',
  audience: 'Who it is for',
  tone: 'How it sounds',
  structure: 'How the video goes',
}

/** Keys that are now shown somewhere better, or are gone from the app
 *  entirely, and must not reappear in the "everything else" fold. The
 *  handles and login moved onto campaign_accounts, one per platform; editing
 *  style was noise he asked to be rid of. */
const RETIRED_KEYS = [
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
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [missing, setMissing] = useState(false)

  const reload = useCallback(async () => {
    if (!campaignId) return null
    const campaign = await data.getCampaign(campaignId)
    if (!campaign) return null

    const [fields, rules] = await Promise.all([
      data.listCampaignFields(campaignId),
      data.listCampaignRules(campaignId),
    ])
    return { campaign, fields, rules }
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

  const { campaign, fields, rules } = loaded
  const byKey = new Map(fields.map((f) => [f.field_key, f]))
  const rest = fields
    .filter((f) => !RETIRED_KEYS.includes(f.field_key))
    .sort((a, b) => a.field_key.localeCompare(b.field_key))

  const perDay = dailyEarningsCents(campaign)

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-text">{campaign.name}</h1>
          {campaign.company ? (
            <p className="text-xs text-state-later">{campaign.company}</p>
          ) : null}
        </div>
        <Link
          to={`/campaigns/${campaign.id}/update`}
          className="shrink-0 rounded-md border border-edge px-2 py-1 text-xs font-semibold text-state-later active:bg-surface-raised"
        >
          Update from a new brief
        </Link>
      </header>

      {/* The three numbers that decide what today owes and what it pays. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-surface px-3 py-2">
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
          <p className="text-[10px] font-semibold uppercase tracking-wide text-state-later">
            per day
          </p>
          <p className="text-sm font-semibold tabular-nums text-text">
            {perDay === null ? 'no rate yet' : formatCents(perDay)}
          </p>
        </div>
      </div>

      {campaign.brief_is_incomplete ? (
        <p className="rounded-md border border-state-waiting/40 bg-state-waiting/10 px-3 py-1.5 text-sm text-state-waiting">
          This brief looks incomplete. Some rules may be missing.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-state-later">
              The brief
            </h2>
            <div className="mt-1 flex flex-col divide-y divide-edge rounded-lg border border-edge bg-surface px-3 text-sm">
              {BRIEF_KEYS.map((key) => (
                <EditableField
                  key={key}
                  field={byKey.get(key) ?? virtualField(campaign.id, key)}
                  label={BRIEF_LABELS[key]}
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

          <HooksEditor campaignId={campaign.id} />
        </div>

        <div className="flex flex-col gap-3">
          <AccountsEditor data={data} campaignId={campaign.id} onChanged={() => void refresh()} />

          {rules.length > 0 ? (
            <details className="rounded-lg border border-edge bg-surface">
              <summary className="flex min-h-tap cursor-pointer items-center px-3 text-sm font-semibold text-state-blocked">
                Never do - {rules.length}
              </summary>
              <ul className="flex flex-col gap-2 border-t border-edge px-3 py-2">
                {rules.map((rule) => (
                  <li
                    key={rule.id}
                    className="border-l-2 border-state-blocked/50 pl-2 text-sm text-text"
                  >
                    {rule.body}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {rest.length > 0 ? (
            <details className="rounded-lg border border-edge bg-surface">
              <summary className="flex min-h-tap cursor-pointer items-center px-3 text-sm font-semibold text-state-later">
                Everything else from the documents - {rest.length}
              </summary>
              <div className="flex flex-col divide-y divide-edge border-t border-edge px-3 py-1 text-sm">
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
            </details>
          ) : null}
        </div>
      </div>
    </section>
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
    <details className="rounded-lg border border-edge bg-surface">
      <summary className="flex min-h-tap cursor-pointer items-center px-3 text-sm font-semibold text-text">
        Hooks &amp; ideas - {hooks.length}
      </summary>

      <div className="border-t border-edge px-3 py-2">
        {hooks.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {hooks.map((hook) => (
              <li key={hook.id} className="flex items-start gap-2">
                <span
                  className={`min-w-0 flex-1 whitespace-pre-wrap text-sm ${
                    hook.used_at === null ? 'text-text' : 'text-state-later line-through'
                  }`}
                >
                  {hook.body}
                  {hook.source === 'generated' ? (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-state-later">
                      generated
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => void remove(hook.id)}
                  aria-label={`Delete hook: ${hook.body.slice(0, 40)}`}
                  className="shrink-0 rounded px-1.5 text-state-later active:bg-surface-raised"
                >
                  ×
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
          className="mt-2 h-24 w-full resize-y rounded-md border border-edge bg-surface-raised p-2 text-sm text-text placeholder:text-state-later"
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy || body.trim() === ''}
          className="mt-1.5 min-h-tap w-full rounded-md border border-edge px-3 text-sm font-semibold text-text active:bg-surface-raised disabled:text-state-later"
        >
          Save to this brief
        </button>
      </div>
    </details>
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
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void save()
            if (event.key === 'Escape') setEditing(false)
          }}
          aria-label={label}
          inputMode="decimal"
          autoFocus
          className="min-h-tap w-20 rounded-md border border-state-now bg-surface-raised px-2 text-sm text-text"
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="rounded-md border border-state-now px-2 py-1 text-xs font-semibold text-state-now active:bg-surface disabled:opacity-60"
        >
          Save
        </button>
        {error ? <span className="text-xs text-state-blocked">{error}</span> : null}
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
      className="rounded-md border border-edge bg-surface-raised px-2 py-1 text-left hover:border-state-now active:bg-surface"
    >
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-state-later">
        {label}
      </span>
      <span className="block text-sm font-semibold tabular-nums text-text">{display}</span>
    </button>
  )
}
