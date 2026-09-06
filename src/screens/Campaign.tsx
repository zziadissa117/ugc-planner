import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { AccountsEditor } from '../components/AccountsEditor'
import { EditableField } from '../components/EditableField'
import { SETUP_TYPE_VALUES } from '../data'
import type {
  BonusTier,
  Campaign as CampaignRow,
  CampaignAngle,
  CampaignField,
  CampaignHook,
  CampaignRule,
  SetupType,
} from '../data'
import {
  ACCOUNT_FIELD_KEYS,
  centsToDollarsInput,
  confirmFieldValue,
  hasAccountHandle,
  parseCount,
  saveFieldValue,
  virtualField,
} from '../data/campaignFields'
import { useData } from '../data/useData'

interface Loaded {
  campaign: CampaignRow
  fields: CampaignField[]
  angles: CampaignAngle[]
  rules: CampaignRule[]
  tiers: BonusTier[]
}

/** Field keys surfaced in the Pay block, so they are not also repeated in the
 *  list below it. Seeing "pay per video: not saved yet" in one section and
 *  "pay per video cents: 3500, unreviewed" in another is the same fact told
 *  twice in two voices. */
const PAY_FIELD_KEYS = ['pay_per_video_cents', 'cycle_size']

/** Display names for the account block. Not fieldLabel()'s mechanical
 *  underscore-replace - these five are a fixed, known set, so the wording is
 *  chosen rather than derived. */
const ACCOUNT_LABELS: Record<string, string> = {
  platforms: 'Platform',
  handle_tiktok: '♪ TikTok',
  handle_instagram: '▣ Instagram',
  account_email: 'Email',
  account_password: 'Password',
}

export function Campaign() {
  const { campaignId } = useParams()
  const data = useData()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [missing, setMissing] = useState(false)

  const reload = useCallback(async () => {
    if (!campaignId) return null
    const campaign = await data.getCampaign(campaignId)
    if (!campaign) return null

    const [fields, angles, rules, tiers] = await Promise.all([
      data.listCampaignFields(campaignId),
      data.listCampaignAngles(campaignId),
      data.listCampaignRules(campaignId),
      data.listBonusTiers(campaignId),
    ])
    return { campaign, fields, angles, rules, tiers }
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

  const { campaign, fields, angles, rules, tiers } = loaded

  // The two sets are rendered from two queries against is_verified and are
  // never concatenated. Merging them would produce a list of angles that no
  // single source actually states.
  const verifiedAngles = angles.filter((a) => a.is_verified)
  const unverifiedAngles = angles.filter((a) => !a.is_verified)

  const byKey = new Map(fields.map((f) => [f.field_key, f]))
  const rest = [...fields]
    .filter((f) => !PAY_FIELD_KEYS.includes(f.field_key) && !ACCOUNT_FIELD_KEYS.includes(f.field_key as never))
    .sort((a, b) => a.field_key.localeCompare(b.field_key))

  const needsReview = rest.filter((f) => f.source === 'parsed_unreviewed')
  const settled = rest.filter(
    (f) => f.source === 'documented' || f.source === 'user_entered',
  )
  const blank = rest.filter((f) => f.source === 'missing')

  return (
    <section className="mx-auto flex max-w-screen-sm flex-col gap-8">
      <header>
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold text-text">{campaign.name}</h1>
          {/* The brief changes every couple of weeks - a new rate, a new
              platform, a document full of hooks. This is how a newer document
              gets merged in rather than creating a second campaign. */}
          <Link
            to={`/campaigns/${campaign.id}/update`}
            className="shrink-0 rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm font-semibold text-state-later active:bg-surface-raised"
          >
            Update from a new brief
          </Link>
        </div>
        <p className="text-state-later">{campaign.company ?? 'company not saved yet'}</p>
        <div className="mt-3">
          <IdentityStrip
            fields={fields}
            campaign={campaign}
            campaignId={campaign.id}
            onSave={saveField}
            onConfirm={confirmField}
          />
        </div>
      </header>

      <AccountsEditor data={data} campaignId={campaign.id} onChanged={() => void refresh()} />

      <LoginBox fields={fields} campaignId={campaign.id} onSave={saveField} onConfirm={confirmField} />

      {campaign.brief_is_incomplete ? (
        <p className="rounded-lg border border-state-waiting/40 bg-state-waiting/10 px-4 py-3 text-state-waiting">
          This brief looks incomplete. Some rules may be missing.
        </p>
      ) : null}

      {needsReview.length > 0 ? (
        <p className="text-sm text-state-waiting">
          {needsReview.length} {needsReview.length === 1 ? 'field was' : 'fields were'} read from
          your documents and nobody has checked {needsReview.length === 1 ? 'it' : 'them'} yet.
          Confirm what is right, edit what is not.
        </p>
      ) : null}

      <div>
        <h2 className="text-lg font-semibold text-text">How you make it</h2>
        <div className="mt-2 flex flex-col divide-y divide-edge">
          {/* The setup drives every time estimate, and without it the planner
              has no honest cost for a video and silently drops it - which is
              why a campaign added by hand could never produce a session list.
              No document states a setup, so it is his to pick. */}
          <SetupPicker
            value={campaign.default_setup}
            onSave={(next) => saveColumn({ default_setup: next })}
          />
          <EditableField
            field={byKey.get('editing_style') ?? virtualField(campaign.id, 'editing_style')}
            label="Editing style"
            onSave={(value) => saveField('editing_style', value)}
          />
        </div>
      </div>

      <HooksEditor campaignId={campaign.id} angles={angles} />

      <div>
        <h2 className="text-lg font-semibold text-text">Pay</h2>
        <div className="mt-2 flex flex-col divide-y divide-edge">
          <PayRow
            fieldKey="cycle_size"
            field={byKey.get('cycle_size')}
            fallbackValue={campaign.cycle_size === null ? null : String(campaign.cycle_size)}
            onSave={saveField}
            onConfirm={confirmField}
          />

          {/* Never in a document, so never parsed - his number or nothing.
              SPEC section 7 and NEVER_PARSED_FIELDS. */}
          <NumberRow
            label="opening balance (posts carried over)"
            value={campaign.opening_post_count}
            onSave={(next) => saveColumn({ opening_post_count: next })}
          />
          <NumberRow
            label="posts owed per day"
            hint="No document states this. Set it yourself, or NOW has nothing to owe you."
            value={campaign.daily_post_quota}
            onSave={(next) => saveColumn({ daily_post_quota: next })}
          />
        </div>
      </div>

      {tiers.length > 0 ? (
        <div>
          <h2 className="text-lg font-semibold text-text">Bonuses</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {tiers.map((tier) => (
              <li key={tier.id} className="flex justify-between gap-4">
                <span className="text-state-later">{tier.label}</span>
                <span className="text-text">
                  ${centsToDollarsInput(tier.payout_cents)}
                  {tier.view_window_days === null
                    ? null
                    : ` - views within ${tier.view_window_days} days only`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
          <h2 className="text-lg font-semibold text-text">Angles</h2>
          <p className="mt-1 text-sm text-state-later">One angle per video. Never mix storylines.</p>

          {/* Two lists, each labelled by its own heading. They are built from
              two separate filters on is_verified and are never concatenated:
              the disagreement between the sources is information, and a merged
              list would destroy it. */}
          {verifiedAngles.length === 0 ? (
            <p className="mt-3 text-sm font-semibold text-state-blocked">
              No angles saved yet - hook generation has nothing to rotate against.
            </p>
          ) : (
            <>
              <h3
                id="angles-from-brief"
                className="mt-4 text-sm font-semibold uppercase tracking-wide text-state-later"
              >
                From the brief
              </h3>
              <ul aria-labelledby="angles-from-brief" className="mt-2 flex flex-col gap-3">
                {verifiedAngles.map((angle) => (
              <li key={angle.id}>
                <p className="font-semibold text-text">
                  {angle.label}
                  {angle.family === null ? null : (
                    <span className="ml-2 text-xs uppercase tracking-wide text-state-later">
                      {angle.family}
                    </span>
                  )}
                </p>
                    {angle.body === null ? null : (
                      <p className="text-sm text-state-later">{angle.body}</p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {unverifiedAngles.length > 0 ? (
            <>
              <h3
                id="angles-from-skill-file"
                className="mt-6 text-sm font-semibold uppercase tracking-wide text-state-waiting"
              >
                From your skill file - not in the brief
              </h3>
              <p className="mt-1 text-sm text-state-waiting">
                The brief documents {verifiedAngles.length}. These {unverifiedAngles.length} appear
                in it only as product context, never as named angles. They are kept apart on purpose
                - there is no list of {verifiedAngles.length + unverifiedAngles.length}.
              </p>
              <ul aria-labelledby="angles-from-skill-file" className="mt-2 flex flex-col gap-3">
                {unverifiedAngles.map((angle) => (
                  <li key={angle.id}>
                    <p className="font-semibold text-state-waiting">{angle.label}</p>
                    {angle.body === null ? null : (
                      <p className="text-sm text-state-later">{angle.body}</p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <AngleEditor campaignId={campaign.id} onAdded={() => void refresh()} />
        </div>

      {rules.length > 0 ? (
        <details className="rounded-lg border border-edge">
          {/* Folded by default. These run to whole paragraphs each, and a
              screen that opens onto a wall of them is a screen he stops
              reading - which defeats the point of having them at all. */}
          <summary className="flex min-h-tap cursor-pointer items-center px-4 font-semibold text-state-blocked">
            Never do - {rules.length} {rules.length === 1 ? 'rule' : 'rules'}
          </summary>
          <ul className="flex flex-col gap-3 border-t border-edge px-4 py-3">
            {rules.map((rule) => (
              <li key={rule.id} className="border-l-2 border-state-blocked/50 pl-3">
                <ClampedText text={rule.body} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {needsReview.length > 0 ? (
        <div>
          <h2 className="text-lg font-semibold text-state-waiting">Needs your review</h2>
          <div className="mt-2 flex flex-col divide-y divide-edge">
            {needsReview.map((field) => (
              <EditableField
                key={field.id}
                field={field}
                onSave={(value) => saveField(field.field_key, value)}
                onConfirm={() => confirmField(field.field_key)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {settled.length > 0 ? (
        <div>
          <h2 className="text-lg font-semibold text-text">Saved</h2>
          <div className="mt-2 flex flex-col divide-y divide-edge">
            {settled.map((field) => (
              <EditableField
                key={field.id}
                field={field}
                onSave={(value) => saveField(field.field_key, value)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {blank.length > 0 ? (
        <details className="rounded-lg border border-edge">
          <summary className="flex min-h-tap cursor-pointer items-center px-4 font-semibold text-state-later">
            Not saved yet - {blank.length}
          </summary>
          <p className="px-4 text-sm text-state-later">
            No document stated these and nothing was guessed. Fill in any that matter.
          </p>
          <div className="mt-2 flex flex-col divide-y divide-edge px-4 pb-3">
            {blank.map((field) => (
              <EditableField
                key={field.id}
                field={field}
                onSave={(value) => saveField(field.field_key, value)}
              />
            ))}
          </div>
        </details>
      ) : null}
    </section>
  )
}

/** Platform, both handles and the pay figure, as one compact row right under
 *  the title - the three facts he needs before he can post at all, read at a
 *  glance instead of hunted through three separate sections. No document ever
 *  states a handle (NEVER_PARSED_FIELDS), so these are his to fill in, and a
 *  campaign with no handle saved at all is flagged in the open here rather
 *  than waiting to be noticed at post time, when the pipeline is what stalls. */
function IdentityStrip({
  fields,
  campaign,
  campaignId,
  onSave,
  onConfirm,
}: {
  fields: CampaignField[]
  campaign: CampaignRow
  campaignId: string
  onSave: (fieldKey: string, value: string | null) => Promise<void>
  onConfirm: (fieldKey: string) => Promise<void>
}) {
  const byKey = new Map(fields.map((f) => [f.field_key, f]))
  const needsHandle = !hasAccountHandle(fields)
  const identityKeys = ['platforms', 'handle_tiktok', 'handle_instagram'] as const

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {identityKeys.map((fieldKey) => (
          <EditableField
            key={fieldKey}
            compact
            field={byKey.get(fieldKey) ?? virtualField(campaignId, fieldKey)}
            label={ACCOUNT_LABELS[fieldKey]}
            onSave={(value) => onSave(fieldKey, value)}
            onConfirm={
              byKey.get(fieldKey)?.source === 'parsed_unreviewed'
                ? () => onConfirm(fieldKey)
                : undefined
            }
          />
        ))}
        <PayRow
          compact
          label="Pay"
          fieldKey="pay_per_video_cents"
          field={byKey.get('pay_per_video_cents')}
          fallbackValue={
            campaign.pay_per_video_cents === null
              ? null
              : `$${centsToDollarsInput(campaign.pay_per_video_cents)}`
          }
          onSave={onSave}
          onConfirm={onConfirm}
        />
      </div>

      {needsHandle ? (
        <p className="mt-2 text-sm font-semibold text-state-blocked">
          No @ handle saved yet - required before this campaign can post.
        </p>
      ) : null}
    </div>
  )
}

/** Email and password, together in one small box - the login, as opposed to
 *  the identity strip above it, because these two are typed once and then
 *  looked up rather than glanced at, and don't need the same prominence as
 *  the @ handle. */
function LoginBox({
  fields,
  campaignId,
  onSave,
  onConfirm,
}: {
  fields: CampaignField[]
  campaignId: string
  onSave: (fieldKey: string, value: string | null) => Promise<void>
  onConfirm: (fieldKey: string) => Promise<void>
}) {
  const byKey = new Map(fields.map((f) => [f.field_key, f]))
  const loginKeys = ['account_email', 'account_password'] as const

  return (
    <div className="inline-flex flex-wrap items-center gap-2 self-start rounded-lg border border-edge bg-surface p-2">
      {loginKeys.map((fieldKey) => (
        <EditableField
          key={fieldKey}
          compact
          mask={fieldKey === 'account_password'}
          field={byKey.get(fieldKey) ?? virtualField(campaignId, fieldKey)}
          label={ACCOUNT_LABELS[fieldKey]}
          onSave={(value) => onSave(fieldKey, value)}
          onConfirm={
            byKey.get(fieldKey)?.source === 'parsed_unreviewed'
              ? () => onConfirm(fieldKey)
              : undefined
          }
        />
      ))}
    </div>
  )
}

/** Adds an angle by hand.
 *
 *  The parser never extracts angles - it was never asked to, and doing so
 *  reliably would mean judging which paragraphs of a brief are "an angle"
 *  rather than reading a fact off it, which is a different kind of claim than
 *  the parser makes anywhere else. So a campaign the parser created has none
 *  until he adds them here, and hook generation has nothing to rotate against
 *  until then.
 *
 *  is_verified defaults to true: an angle typed in here is one he read off
 *  the real brief, the same standing as a parsed field he confirmed - not a
 *  skill-file guess. He can mark it false if it genuinely is not from the
 *  brief. */
function AngleEditor({ campaignId, onAdded }: { campaignId: string; onAdded: () => void }) {
  const data = useData()
  const [label, setLabel] = useState("")
  const [body, setBody] = useState("")
  const [family, setFamily] = useState("")
  const [fromBrief, setFromBrief] = useState(true)
  const [busy, setBusy] = useState(false)

  async function add() {
    if (label.trim() === "") return
    setBusy(true)
    try {
      await data.addCampaignAngle({
        campaign_id: campaignId,
        label: label.trim(),
        body: body.trim() === "" ? null : body.trim(),
        family: family.trim() === "" ? null : family.trim(),
        is_verified: fromBrief,
        sort_order: 0,
      })
      setLabel("")
      setBody("")
      setFamily("")
      onAdded()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-edge bg-surface p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-state-later">Add an angle</p>
      <input
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        aria-label="Angle label"
        placeholder="Label, e.g. A. Frozen funds"
        className="mt-2 min-h-tap w-full rounded-lg border border-edge bg-surface-raised px-3 text-text placeholder:text-state-later"
      />
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        aria-label="Angle description"
        placeholder="What the angle is, in a sentence (optional)."
        className="mt-2 h-16 w-full resize-y rounded-lg border border-edge bg-surface-raised p-3 text-text placeholder:text-state-later"
      />
      <input
        value={family}
        onChange={(event) => setFamily(event.target.value)}
        aria-label="Family"
        placeholder="Family, e.g. fear or greed (optional)"
        className="mt-2 min-h-tap w-full rounded-lg border border-edge bg-surface-raised px-3 text-text placeholder:text-state-later"
      />
      <label className="mt-2 flex items-center gap-2 text-sm text-state-later">
        <input
          type="checkbox"
          checked={fromBrief}
          onChange={(event) => setFromBrief(event.target.checked)}
        />
        This is really in the brief, not just background context
      </label>
      <button
        type="button"
        onClick={() => void add()}
        disabled={busy || label.trim() === ""}
        className="mt-2 min-h-tap w-full rounded-lg border border-edge bg-surface px-4 font-semibold text-text active:bg-surface-raised disabled:text-state-later"
      >
        Add angle
      </button>
    </div>
  )
}

/** The hooks he works down in a FILM session.
 *
 *  Kept here rather than in campaign_fields: a field is a claim about a
 *  document and carries a quote that can be checked against it, and a hook is
 *  invented text that no document contains. What matters instead is who wrote
 *  it, which is what `source` records - so a line he typed can never be
 *  mistaken later for one a model produced. */
function HooksEditor({ campaignId, angles }: { campaignId: string; angles: CampaignAngle[] }) {
  const data = useData()
  const [hooks, setHooks] = useState<CampaignHook[]>([])
  const [body, setBody] = useState("")
  const [angleId, setAngleId] = useState("")
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setHooks(await data.listCampaignHooks(campaignId))
  }, [campaignId, data])

  useEffect(() => {
    void reload()
  }, [reload])

  async function add() {
    if (body.trim() === "") return
    setBusy(true)
    try {
      await data.addCampaignHook({
        campaign_id: campaignId,
        angle_id: angleId === "" ? null : angleId,
        body: body.trim(),
        outline: null,
        // His words. A model never wrote this, so it must not claim one did.
        source: "user_entered",
        model: null,
        generated_at: null,
        used_at: null,
      })
      setBody("")
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const anglesById = new Map(angles.map((a) => [a.id, a]))

  return (
    <div>
      <h2 className="text-lg font-semibold text-text">Hooks</h2>
      <p className="mt-1 text-sm text-state-later">
        The openers you work down while filming. Nothing is written for you here.
      </p>

      {hooks.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {hooks.map((hook) => {
            const angle = hook.angle_id === null ? undefined : anglesById.get(hook.angle_id)
            return (
              <li key={hook.id} className="rounded-lg border border-edge bg-surface px-3 py-2">
                <p className={hook.used_at === null ? "text-text" : "text-state-later line-through"}>
                  {hook.body}
                </p>
                <p className="text-xs uppercase tracking-wide text-state-later">
                  {angle ? angle.label : "no angle"}
                  {angle?.family ? " - " + angle.family : ""}
                  {hook.source === "generated" ? " - generated" : " - you wrote this"}
                </p>
              </li>
            )
          })}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-col gap-2">
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          aria-label="New hook"
          placeholder="Type a hook."
          className="h-20 w-full resize-y rounded-lg border border-edge bg-surface p-3 text-text placeholder:text-state-later"
        />
        {angles.length > 0 ? (
          <select
            value={angleId}
            onChange={(event) => setAngleId(event.target.value)}
            aria-label="Angle"
            className="min-h-tap rounded-lg border border-edge bg-surface px-3 text-text"
          >
            <option value="">No angle</option>
            {angles.map((angle) => (
              <option key={angle.id} value={angle.id}>
                {angle.label}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy || body.trim() === ""}
          className="min-h-tap rounded-lg border border-edge bg-surface px-4 font-semibold text-text active:bg-surface-raised disabled:text-state-later"
        >
          Add hook
        </button>
      </div>
    </div>
  )
}

/** The filming setup this campaign defaults to.
 *
 *  Four buttons rather than a text field: it is an enum in the schema, and a
 *  typo here does not read as a typo - it reads as a campaign the planner
 *  quietly refuses to schedule, because stageMinutes returns null for a setup
 *  it does not recognise and the fitter drops anything it cannot cost. */
function SetupPicker({
  value,
  onSave,
}: {
  value: SetupType | null
  onSave: (next: SetupType) => Promise<void>
}) {
  const [busy, setBusy] = useState<SetupType | null>(null)

  async function choose(setup: SetupType) {
    setBusy(setup)
    try {
      await onSave(setup)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="py-2">
      <p className="text-sm text-state-later">default setup</p>
      {value === null ? (
        <p className="mt-1 text-sm font-semibold text-state-blocked">
          Not set - "Or plan it for me" on the campaign picker will skip this campaign until it is.
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {SETUP_TYPE_VALUES.map((setup) => (
          <button
            key={setup}
            type="button"
            disabled={busy !== null}
            onClick={() => void choose(setup)}
            aria-pressed={value === setup}
            className={[
              'min-h-tap rounded-lg border px-4 font-semibold active:bg-surface-raised disabled:opacity-60',
              value === setup
                ? 'border-state-now bg-surface-raised text-state-now'
                : 'border-edge bg-surface text-state-later',
            ].join(' ')}
          >
            {setup}
          </button>
        ))}
      </div>
    </div>
  )
}

/** A pay figure. Backed by a parsed field where one exists - so it can be
 *  confirmed or corrected in place - and by the campaign column where the
 *  parser never produced a field at all. */
function PayRow({
  fieldKey,
  field,
  fallbackValue,
  onSave,
  onConfirm,
  compact,
  label,
}: {
  fieldKey: string
  field: CampaignField | undefined
  fallbackValue: string | null
  onSave: (fieldKey: string, value: string | null) => Promise<void>
  onConfirm: (fieldKey: string) => Promise<void>
  compact?: boolean
  label?: string
}) {
  if (field) {
    return (
      <EditableField
        compact={compact}
        label={label}
        field={field}
        onSave={(value) => onSave(fieldKey, value)}
        onConfirm={
          field.source === 'parsed_unreviewed' ? () => onConfirm(fieldKey) : undefined
        }
      />
    )
  }

  return (
    <EditableField
      compact={compact}
      label={label}
      field={{
        id: `virtual-${fieldKey}`,
        user_id: '',
        campaign_id: '',
        field_key: fieldKey,
        field_value: fallbackValue,
        source: fallbackValue === null ? 'missing' : 'user_entered',
        source_quote: null,
        source_document_id: null,
        confirmed_at: null,
        updated_at: '',
      }}
      onSave={(value) => onSave(fieldKey, value)}
    />
  )
}

/** One of the counts no document ever states. */
function NumberRow({
  label,
  hint,
  value,
  onSave,
}: {
  label: string
  hint?: string
  value: number
  onSave: (next: number) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    const parsed = parseCount(draft)
    if (parsed === null) {
      setError('Enter a whole number.')
      return
    }
    setBusy(true)
    try {
      await onSave(parsed)
      setEditing(false)
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className="rounded-lg border border-state-now bg-surface p-3">
        <label
          htmlFor={`edit-${label}`}
          className="text-xs font-semibold uppercase tracking-wide text-state-later"
        >
          {label}
        </label>
        <input
          id={`edit-${label}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          inputMode="numeric"
          autoFocus
          className="mt-2 min-h-tap w-full rounded-lg border border-edge bg-surface-raised px-3 text-text"
        />
        {error ? <p className="mt-2 text-sm text-state-blocked">{error}</p> : null}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="min-h-tap flex-1 rounded-lg border border-state-now bg-surface-raised px-4 font-semibold text-state-now active:bg-surface disabled:opacity-60"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="min-h-tap flex-1 rounded-lg border border-edge bg-surface px-4 font-semibold text-state-later active:bg-surface-raised"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-state-later">{label}</p>
        <p className="text-text">{value}</p>
        {hint ? <p className="text-xs text-state-later">{hint}</p> : null}
      </div>
      <button
        type="button"
        onClick={() => {
          setDraft(String(value))
          setError(null)
          setEditing(true)
        }}
        className="min-h-tap shrink-0 rounded-lg border border-edge px-3 text-sm font-semibold text-state-later active:bg-surface-raised"
      >
        Edit
      </button>
    </div>
  )
}

/** Long rule bodies, folded to a readable height until asked for. */
function ClampedText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const long = text.length > 160

  if (!long) return <p className="text-sm text-text">{text}</p>

  return (
    <div>
      <p className={`text-sm text-text ${expanded ? '' : 'line-clamp-2'}`}>{text}</p>
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="mt-1 text-xs font-semibold uppercase tracking-wide text-state-later"
      >
        {expanded ? 'Less' : 'More'}
      </button>
    </div>
  )
}

// formatCents lived here; money display now goes through centsToDollarsInput
// in src/data/campaignFields.ts so parsing and rendering agree on what a cent
// is.
