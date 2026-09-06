// The FILM and EDIT console.
//
// One screen with everything on it, because he reads it off a laptop while
// filming on his phone - not a wizard that shows one video at a time and hides
// the rules behind a tap. What he asked for, in his order: a quick summary of
// the campaign, hooks to work down, what he can and cannot say, a timer, and a
// goal of N videos to count off.
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
  SessionType,
  Video,
} from '../data'
import { SESSION_TARGET_PHASE } from '../data/phases'
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
import { formatMinutes } from '../session'

/** Fields that describe the campaign in a couple of lines, in the order he
 *  needs them: what it is, who it is for, how it should sound. */
const SUMMARY_KEYS = ['product_facts', 'audience', 'tone'] as const

/** What he is allowed to say, assembled from what the brief already stores
 *  rather than from a second list he has to keep in step by hand. A section
 *  with nothing behind it says so - the same rule as the ChatGPT block. */
const CAN_SAY_KEYS = ['product_facts', 'disclosure', 'structure'] as const

export function Console({
  campaign,
  sessionType,
  goal,
  plannedMinutes,
  workSessionId,
  startedAt,
  onFinish,
}: {
  campaign: Campaign
  sessionType: SessionType
  goal: number
  plannedMinutes: number
  workSessionId: string
  startedAt: number
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
  const [warnings, setWarnings] = useState<string[]>([])
  const [lastFamily, setLastFamily] = useState<string | null>(null)

  const targetPhase = SESSION_TARGET_PHASE[sessionType]

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
      // The oldest video this session's stage can act on, so the backlog
      // drains rather than growing a tail.
      const waiting = await data.listVideos({ campaignId: campaign.id, phases: [targetPhase] })
      const next: Video | undefined = waiting[0]

      if (next) {
        await data.advanceVideoPhase(next.id, { session: sessionType, workSessionId })
      } else if (sessionType === 'film') {
        // Nothing is waiting, so this is supply built ahead of demand. Created
        // with owed_for_date null - it is stock, not an obligation for any
        // particular day - and advanced straight away, because he just filmed
        // it.
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
        await data.advanceVideoPhase(created.id, { session: sessionType, workSessionId })
      } else {
        setError('Nothing left to edit for this campaign - film some first.')
        return
      }
      await reload()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }, [campaign.default_setup, campaign.id, data, reload, sessionType, targetPhase, workSessionId])

  const generate = useCallback(async () => {
    setGenerating(true)
    setError(null)
    setWarnings([])
    try {
      const [fieldRows, ruleRows, angleRows] = await Promise.all([
        data.listCampaignFields(campaign.id),
        data.listCampaignRules(campaign.id),
        data.listCampaignAngles(campaign.id),
      ])
      const context = buildContext({
        campaign,
        fields: fieldRows,
        rules: ruleRows,
        angles: angleRows,
        lastFamily,
        // Enough for the evening he planned, with a couple spare so a hook he
        // does not like is not the end of the list.
        count: Math.max(3, goal + 2),
      })
      const result = await generateHooks(context)
      await saveGeneratedHooks(data, campaign.id, result, DEFAULT_HOOK_MODEL)
      setWarnings(result.warnings)
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
      <Scoreboard
        done={done}
        goal={goal}
        plannedMinutes={plannedMinutes}
        startedAt={startedAt}
        campaignName={campaign.name}
      />

      <button
        type="button"
        onClick={() => void advance()}
        disabled={busy}
        className="min-h-[4.5rem] w-full rounded-lg border border-state-now bg-surface-raised px-4 text-xl font-semibold tracking-wide text-state-now active:bg-surface disabled:opacity-60"
      >
        {sessionType === 'film' ? 'Filmed one' : 'Edited one'}
      </button>

      {error ? <p className="text-sm text-state-blocked">{error}</p> : null}

      {sessionType === 'edit' ? (
        <Section title="Your editing style">
          <Prose
            value={byKey.get('editing_style') ?? null}
            missing="Not saved yet - add it on the brief page."
          />
        </Section>
      ) : (
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

          {warnings.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1">
              {warnings.map((warning) => (
                <li key={warning} className="text-xs text-state-waiting">
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
      )}

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

/** How many, and how long. The two numbers he asked to be able to watch. */
function Scoreboard({
  done,
  goal,
  plannedMinutes,
  startedAt,
  campaignName,
}: {
  done: number
  goal: number
  plannedMinutes: number
  startedAt: number
  campaignName: string
}) {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const elapsed = Math.max(0, Math.floor((nowMs - startedAt) / 1000))
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')
  const percent = goal === 0 ? 0 : Math.min(100, Math.round((done / goal) * 100))

  return (
    <div>
      <p className="text-sm uppercase tracking-wide text-state-later">{campaignName}</p>
      <div className="mt-1 flex items-baseline justify-between gap-4">
        <p className="text-3xl font-semibold tabular-nums text-text">
          {done} <span className="text-state-later">of {goal}</span>
        </p>
        {/* Amber once he is past the window he set - a state, not decoration. */}
        <p
          aria-label="Elapsed"
          className={`text-xl tabular-nums ${
            elapsed > plannedMinutes * 60 ? 'text-state-waiting' : 'text-state-later'
          }`}
        >
          {mm}:{ss}
          <span className="ml-2 text-sm">of {formatMinutes(plannedMinutes)}</span>
        </p>
      </div>
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
