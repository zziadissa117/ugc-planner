// The FILM console.
//
// One screen with everything on it, because he reads it off a laptop while
// filming on his phone - not a wizard that shows one video at a time and hides
// the rules behind a tap. What he asked for, in his order: a quick summary of
// the campaign, hooks to work down, what he can and cannot say, and a goal of
// N videos to count off.
//
// No timer, and no EDIT version of this screen. Both were noise: a session
// timer next to a goal he is already watching told him nothing he needed, and
// a whole second console - goal, hooks, campaign summary - existed for a stage
// that only ever needed his own editing style. Editing is now a single button
// on the home screen; see `EditBacklog` in Now.tsx.
//
// The counter is derived, never stored: it counts the phase_events this
// sitting produced. A number held anywhere else can disagree with the log, and
// the log is the thing that has to be true.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import type {
  Campaign,
  CampaignAngle,
  CampaignField,
  CampaignHook,
  CampaignRule,
  PhaseEvent,
} from '../data'
import { useData } from '../data/useData'
import {
  DEFAULT_HOOK_MODEL,
  buildContext,
  generateHooks,
  hookGenerationAvailable,
  lastFamilyUsed,
  leaningFamily,
  saveGeneratedHooks,
} from '../hooks/generateHooks'

/** Fields that describe the campaign in a couple of lines, in the order he
 *  needs them: what it is, who it is for, how it should sound. */
const SUMMARY_KEYS = ['product_facts', 'audience', 'tone'] as const

/** What he is allowed to say, assembled from what the brief already stores
 *  rather than from a second list he has to keep in step by hand. A section
 *  with nothing behind it says so - the same rule as the ChatGPT block. */
const CAN_SAY_KEYS = ['product_facts', 'disclosure', 'structure'] as const

export function Console({
  campaign,
  goal,
  workSessionId,
  onFinish,
}: {
  campaign: Campaign
  goal: number
  workSessionId: string
  onFinish: () => void
}) {
  const data = useData()

  const [fields, setFields] = useState<CampaignField[]>([])
  const [rules, setRules] = useState<CampaignRule[]>([])
  const [angles, setAngles] = useState<CampaignAngle[]>([])
  const [hooks, setHooks] = useState<CampaignHook[]>([])
  const [events, setEvents] = useState<PhaseEvent[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  /** One line about the batch, written by the app from what it counted.
   *  Never the generator's own `warnings` - that is where it explains itself
   *  ("Kept angle_id null throughout", "Spread hooks across Format A x3"),
   *  and a paragraph of that under every batch is noise he cannot act on. */
  const [note, setNote] = useState<string | null>(null)
  const [lastFamily, setLastFamily] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const [nextFields, nextRules, nextAngles, nextHooks, nextEvents] = await Promise.all([
      data.listCampaignFields(campaign.id),
      data.listCampaignRules(campaign.id),
      data.listCampaignAngles(campaign.id),
      data.listCampaignHooks(campaign.id),
      data.listPhaseEvents(),
    ])
    setFields(nextFields)
    setRules(nextRules)
    setAngles(nextAngles)
    setHooks(nextHooks)
    setEvents(nextEvents)
    setLastFamily(await lastFamilyUsed(data, campaign.id, nextAngles))
  }, [campaign.id, data])

  useEffect(() => {
    void reload()
  }, [reload])

  const byKey = useMemo(() => new Map(fields.map((f) => [f.field_key, f.field_value])), [fields])
  const anglesById = useMemo(() => new Map(angles.map((a) => [a.id, a])), [angles])

  // Counted off the append-only log rather than held in state: it survives a
  // reload, and it cannot drift from the history that explains it.
  const done = events.filter((e) => e.work_session_id === workSessionId).length

  const advance = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      // Today's owed quota raises rows at `to_film` before he ever opens this
      // console - drain those first, so a video already owed for today gets
      // filled rather than left sitting while fresh stock piles up next to it.
      const waiting = await data.listVideos({ campaignId: campaign.id, phases: ['to_film'] })
      const next = waiting[0]

      if (next) {
        await data.advanceVideoPhase(next.id, { session: 'film', workSessionId })
      } else {
        // Nothing owed is waiting, so this is supply built ahead of demand -
        // created with owed_for_date null, since it is stock rather than an
        // obligation for any particular day, and advanced straight away
        // because he just filmed it.
        const created = await data.createVideo({
          campaign_id: campaign.id,
          setup: campaign.default_setup,
          angle_id: null,
          script: null,
          blocked_reason: null,
          owed_for_date: null,
          rate_snapshot_cents: null,
          posted_at: null,
        })
        await data.advanceVideoPhase(created.id, { session: 'film', workSessionId })
      }
      await reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }, [campaign.default_setup, campaign.id, data, reload, workSessionId])

  const generate = useCallback(async () => {
    setGenerating(true)
    setError(null)
    setNote(null)
    try {
      const [fieldRows, ruleRows, angleRows, hookRows] = await Promise.all([
        data.listCampaignFields(campaign.id),
        data.listCampaignRules(campaign.id),
        data.listCampaignAngles(campaign.id),
        data.listCampaignHooks(campaign.id),
      ])
      const context = buildContext({
        campaign,
        fields: fieldRows,
        rules: ruleRows,
        angles: angleRows,
        // What he dumped into the brief is what this builds from.
        hooks: hookRows,
        lastFamily,
        // Enough for the evening he planned, with a couple spare so a hook he
        // does not like is not the end of the list.
        count: Math.max(3, goal + 2),
      })
      const result = await generateHooks(context)
      const asked = Math.max(3, goal + 2)
      const { saved, duplicates } = await saveGeneratedHooks(
        data,
        campaign.id,
        result,
        DEFAULT_HOOK_MODEL,
      )

      // Silence when he got what he asked for: the hooks are the answer.
      const parts: string[] = []
      if (saved < asked) parts.push(`${saved} of ${asked}`)
      if (duplicates > 0) {
        parts.push(`${duplicates} you already had ${duplicates === 1 ? 'was' : 'were'} skipped`)
      }
      setNote(parts.length > 0 ? parts.join(' - ') : null)
      await reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setGenerating(false)
    }
  }, [campaign, data, goal, lastFamily, reload])

  const toggleHook = useCallback(
    async (hook: CampaignHook) => {
      await data.setHookUsed(hook.id, hook.used_at === null)
      await reload()
    },
    [data, reload],
  )

  return (
    <div className="flex flex-col gap-6">
      <Scoreboard done={done} goal={goal} campaignName={campaign.name} />

      <button
        type="button"
        onClick={() => void advance()}
        disabled={busy}
        className="min-h-[4.5rem] w-full rounded-lg border border-state-now bg-surface-raised px-4 text-xl font-semibold tracking-wide text-state-now active:bg-surface disabled:opacity-60"
      >
        Filmed one
      </button>

      {error ? <p className="text-sm text-state-blocked">{error}</p> : null}

      <Section title="Hooks">
        {lastFamily !== null && leaningFamily(angles, lastFamily) !== null ? (
          <p className="mb-2 text-xs uppercase tracking-wide text-state-later">
            Last one was {lastFamily} - lean {leaningFamily(angles, lastFamily)} next
          </p>
        ) : null}

        <Hooks hooks={hooks} anglesById={anglesById} onToggle={toggleHook} />

        {hookGenerationAvailable() ? (
          <button
            type="button"
            onClick={() => void generate()}
            disabled={generating}
            className="mt-3 min-h-tap w-full rounded-lg border border-edge bg-surface px-4 font-semibold text-text active:bg-surface-raised disabled:text-state-later"
          >
            {generating ? 'Writing hooks...' : 'Write me some hooks'}
          </button>
        ) : null}

        {note === null ? null : <p className="mt-2 text-xs text-state-later">{note}</p>}
      </Section>

      <Section title="The campaign, quickly">
        {SUMMARY_KEYS.every((key) => !byKey.get(key)) ? (
          <p className="text-sm text-state-later">
            Nothing saved yet. Nothing is written here on your behalf.
          </p>
        ) : (
          SUMMARY_KEYS.map((key) => <Prose key={key} value={byKey.get(key) ?? null} missing={null} />)
        )}
      </Section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="You can say">
          <CanSay byKey={byKey} />
        </Section>

        <Section title="Never do">
          {rules.length === 0 ? (
            <p className="text-sm text-state-later">No rules saved for this campaign yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {rules.map((rule) => (
                <li key={rule.id} className="border-l-2 border-state-blocked/60 pl-3 text-sm text-text">
                  {rule.body}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <button
        type="button"
        onClick={onFinish}
        className="min-h-tap rounded-lg border border-edge bg-surface px-4 font-semibold text-state-later active:bg-surface-raised"
      >
        Finish this session
      </button>
    </div>
  )
}

/** How many, of how many. The one number he asked to be able to watch - no
 *  clock next to it, since nothing here is timed. */
function Scoreboard({
  done,
  goal,
  campaignName,
}: {
  done: number
  goal: number
  campaignName: string
}) {
  const percent = goal === 0 ? 0 : Math.min(100, Math.round((done / goal) * 100))

  return (
    <div>
      <p className="text-sm uppercase tracking-wide text-state-later">{campaignName}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-text">
        {done} <span className="text-state-later">of {goal}</span>
      </p>
      <div
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={goal}
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-raised"
      >
        <div className="h-full bg-state-posted" style={{ width: `${percent}%` }} />
      </div>
      {done >= goal ? (
        <p className="mt-2 text-sm text-state-posted">
          Goal reached. Anything more tonight is stock in the bank.
        </p>
      ) : null}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-state-later">{title}</h2>
      <div className="mt-2">{children}</div>
    </div>
  )
}

function Prose({ value, missing }: { value: string | null; missing: string | null }) {
  if (value === null || value === '') {
    return missing === null ? null : <p className="text-sm text-state-later">{missing}</p>
  }
  return <p className="text-sm leading-relaxed text-text">{value}</p>
}

/** Built from what the brief already says, so there is no second list to keep
 *  in step - and nothing is invented to fill the column out. */
function CanSay({ byKey }: { byKey: Map<string, string | null> }) {
  const lines = CAN_SAY_KEYS.map((key) => byKey.get(key)).filter(
    (value): value is string => typeof value === 'string' && value !== '',
  )

  if (lines.length === 0) {
    return (
      <p className="text-sm text-state-later">
        Nothing saved yet. Nothing is assumed on your behalf.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {lines.map((line) => (
        <li key={line} className="border-l-2 border-state-posted/50 pl-3 text-sm text-text">
          {line}
        </li>
      ))}
    </ul>
  )
}

/** The hooks he works down. Each carries its angle and the angle's family, so
 *  alternating FEAR and GREED is something he can see rather than remember. */
function Hooks({
  hooks,
  anglesById,
  onToggle,
}: {
  hooks: CampaignHook[]
  anglesById: Map<string, CampaignAngle>
  onToggle: (hook: CampaignHook) => Promise<void>
}) {
  if (hooks.length === 0) {
    return (
      <p className="text-sm text-state-later">
        No hooks saved yet. Add them on the brief page - nothing is written for you here.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {hooks.map((hook) => {
        const angle = hook.angle_id === null ? undefined : anglesById.get(hook.angle_id)
        const used = hook.used_at !== null
        return (
          <li key={hook.id}>
            <button
              type="button"
              onClick={() => void onToggle(hook)}
              className="w-full rounded-lg border border-edge bg-surface px-3 py-2 text-left active:bg-surface-raised"
            >
              <span className={used ? 'text-state-later line-through' : 'text-text'}>
                {hook.body}
              </span>
              {angle ? (
                <span className="ml-2 text-xs uppercase tracking-wide text-state-later">
                  {angle.label}
                  {angle.family === null ? '' : ` - ${angle.family}`}
                </span>
              ) : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
