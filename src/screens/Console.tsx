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
import { CheckIcon, ChevronDownIcon, SparkIcon } from '../components/icons'
import { Button, SectionLabel } from '../components/ui'
import { type Tone } from '../components/styles'
import { stripMarker, talkingPointsFromBrief } from '../data/briefSections'
import { useData } from '../data/useData'
import {
  GENERATION_BRIEF_KEY,
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

/** The points to hit in the body of the video, pinned so they stay on screen
 *  however far he scrolls.
 *
 *  "i already have the hook, i just need inspiration for the body of what im
 *  going to say, not the CTA i can figure that out by myself." So this is the
 *  middle of the video and nothing else: not the opening line, which the hooks
 *  list above already gives him, and not the close.
 *
 *  Two places it can come from, in order. His own `talking_points` field
 *  wins. Failing that, the TALKING POINTS section of the working brief he
 *  already pasted in whole - the document says it, and asking him to copy a
 *  part of it into a second field by hand is work the app can do.
 *
 *  `structure` used to be the fallback and is not any more. It is the same
 *  question in principle, but in practice it is a paragraph that ends in the
 *  call to action - the one thing he said he writes himself - and that is
 *  exactly what it served him for Vertus. A campaign with neither source
 *  shows no strip at all, which is honest; the alternative was showing him
 *  the wrong thing while the camera was running. */
const SAY_THIS_FIELD = 'talking_points'

/** Enough to glance at between takes. More than this and he is reading a
 *  script, which is not what he asked for and not what the pinned strip has
 *  room to be.
 *
 *  Eight rather than six: he asks the brief for at least six, and a cap of
 *  six would have silently clipped every list that did what it was told. */
const MAX_SAY_THIS_LINES = 8

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
      const { saved, duplicates } = await saveGeneratedHooks(data, campaign.id, result)

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

  const sayThis = (() => {
    const typed = (byKey.get(SAY_THIS_FIELD) ?? '')
      .split('\n')
      .map(stripMarker)
      .filter((line: string) => line !== '')
    if (typed.length > 0) return typed.slice(0, MAX_SAY_THIS_LINES)

    const fromBrief = talkingPointsFromBrief(byKey.get(GENERATION_BRIEF_KEY) ?? null)
    return fromBrief.slice(0, MAX_SAY_THIS_LINES)
  })()

  return (
    <div className="flex flex-col gap-7">
      <SayThis lines={sayThis} />

      <Scoreboard done={done} goal={goal} campaignName={campaign.name} />

      <Button variant="now" size="big" onClick={() => void advance()} disabled={busy} className="!min-h-[5rem] !text-xl">
        Filmed one
      </Button>

      {error ? <p className="text-base text-state-blocked">{error}</p> : null}

      <Section
        title="Hooks"
        trailing={
          lastFamily !== null && leaningFamily(angles, lastFamily) !== null
            ? `last ${lastFamily} · lean ${leaningFamily(angles, lastFamily)}`
            : undefined
        }
      >
        <Hooks hooks={hooks} anglesById={anglesById} onToggle={toggleHook} />

        {hookGenerationAvailable() ? (
          <div className="mt-4 flex flex-col gap-2">
            <Button onClick={() => void generate()} disabled={generating} className="w-full">
              <SparkIcon className="h-5 w-5" />
              {generating ? 'Writing hooks...' : 'Write me some hooks'}
            </Button>
            {generating ? (
              // One request, no progress to report - so it says "working"
              // without pretending to know how far along it is.
              <div aria-hidden className="h-px overflow-hidden bg-rule">
                <div className="indeterminate-bar h-full w-1/4 bg-state-now" />
              </div>
            ) : null}
          </div>
        ) : null}

        {note === null ? null : <p className="meta mt-2 text-state-later">{note}</p>}
      </Section>

      <Section title="The campaign, quickly">
        {SUMMARY_KEYS.every((key) => !byKey.get(key)) ? (
          <p className="text-base text-state-later">
            Nothing saved yet. Nothing is written here on your behalf.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {SUMMARY_KEYS.map((key) => (
              <Prose key={key} value={byKey.get(key) ?? null} missing={null} />
            ))}
          </div>
        )}
      </Section>

      <div className="grid gap-7 sm:grid-cols-2">
        <Section title="You can say" tone="posted">
          <CanSay byKey={byKey} />
        </Section>

        <Section title="Never do" tone="blocked">
          {rules.length === 0 ? (
            <p className="text-base text-state-later">No rules saved for this campaign yet.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {rules.map((rule) => (
                <li key={rule.id} className="border-l border-state-blocked/70 pl-3 text-base leading-snug text-text">
                  {rule.body}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Button variant="quiet" onClick={onFinish}>
        Finish this session
      </Button>
    </div>
  )
}

/** The body of the video, pinned to the top of the console.
 *
 *  Sticky rather than just first, because he scrolls this screen while the
 *  camera is running and asked for something that stays: "a widget that i can
 *  see no matter where i scroll on the app that tells me what i need to say".
 *  Black glass with a hairline edge, so the screen visibly continues
 *  underneath rather than the page appearing to start here.
 *
 *  Collapsible, and that is the whole of its chrome: on a phone five lines is
 *  most of the screen, and between takes he wants the hooks back. */
function SayThis({ lines }: { lines: string[] }) {
  const [open, setOpen] = useState(true)

  if (lines.length === 0) return null

  return (
    <div className="sticky top-0 z-20 -mx-4 border-b border-rule bg-ink/90 px-4 pb-3 pt-2 backdrop-blur-xl">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex min-h-10 w-full items-center justify-between gap-3 text-left"
      >
        <span className="label text-state-later">Say this</span>
        <span className="label flex items-center gap-1.5 text-state-later">
          {open ? 'hide' : `${lines.length} ${lines.length === 1 ? 'point' : 'points'}`}
          <ChevronDownIcon
            className={`h-4 w-4 transition-transform duration-300 [transition-timing-function:var(--ease-settle)] ${open ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      {open ? (
        <ol className="settle-in flex flex-col gap-1.5">
          {lines.map((line, index) => (
            <li key={line} className="flex gap-3 text-base leading-snug text-text">
              <span className="numeric w-4 shrink-0 text-right text-state-later">{index + 1}</span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}

/** How many, of how many. The one number he asked to be able to watch - no
 *  clock next to it, since nothing here is timed. One segment per video in
 *  the goal, each landing green with the pop spring as it is filmed. */
function Scoreboard({
  done,
  goal,
  campaignName,
}: {
  done: number
  goal: number
  campaignName: string
}) {
  const segmented = goal > 0 && goal <= 20
  const percent = goal === 0 ? 0 : Math.min(100, Math.round((done / goal) * 100))

  return (
    <div className="flex flex-col gap-3">
      <p className="display text-2xl text-text-dim">{campaignName}</p>
      <p className="numeric font-semibold leading-none text-text" style={{ fontSize: 'clamp(3.25rem, 17vw, 4.5rem)' }}>
        <span className={done >= goal && goal > 0 ? 'text-state-posted' : 'text-text'}>{done}</span>{' '}
        <span className="text-state-later">of {goal}</span>
      </p>
      <div role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={goal}>
        {segmented ? (
          <div className="flex gap-1.5">
            {Array.from({ length: goal }, (_, index) => (
              <span key={index} className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-rule">
                {index < done ? <span className="pop-in absolute inset-0 rounded-full bg-state-posted" /> : null}
              </span>
            ))}
          </div>
        ) : (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-rule">
            <div
              className="h-full bg-state-posted transition-[width] duration-700 [transition-timing-function:var(--ease-settle)]"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </div>
      {done >= goal ? (
        <p className="settle-in text-base text-state-posted">
          Goal reached. Anything more tonight is stock in the bank.
        </p>
      ) : null}
    </div>
  )
}

function Section({
  title,
  tone = 'later',
  trailing,
  children,
}: {
  title: string
  tone?: Tone
  trailing?: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <SectionLabel tone={tone} trailing={trailing}>
        {title}
      </SectionLabel>
      <div>{children}</div>
    </section>
  )
}

function Prose({ value, missing }: { value: string | null; missing: string | null }) {
  if (value === null || value === '') {
    return missing === null ? null : <p className="text-base text-state-later">{missing}</p>
  }
  return <p className="text-base leading-relaxed text-text">{value}</p>
}

/** Built from what the brief already says, so there is no second list to keep
 *  in step - and nothing is invented to fill the column out. */
function CanSay({ byKey }: { byKey: Map<string, string | null> }) {
  const lines = CAN_SAY_KEYS.map((key) => byKey.get(key)).filter(
    (value): value is string => typeof value === 'string' && value !== '',
  )

  if (lines.length === 0) {
    return (
      <p className="text-base text-state-later">
        Nothing saved yet. Nothing is assumed on your behalf.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {lines.map((line) => (
        <li key={line} className="border-l border-state-posted/60 pl-3 text-base leading-snug text-text">
          {line}
        </li>
      ))}
    </ul>
  )
}

/** The hooks he works down. Each carries its angle and the angle's family, so
 *  alternating FEAR and GREED is something he can see rather than remember.
 *
 *  A generated hook says so, on the hook itself - it used to render exactly
 *  like a line he wrote, which is the one thing CLAUDE.md says a generated
 *  hook must never do. Under it, while it is still to film, sit its body
 *  beats: "i already have the hook, i just need inspiration for the body of
 *  what im going to say". Once used, it collapses to the line, struck, with a
 *  tick - done is a state, so it is green. */
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
      <p className="text-base text-state-later">
        No hooks saved yet. Add them on the brief page - nothing is written for you here.
      </p>
    )
  }

  return (
    <ul className="flex flex-col divide-y divide-rule border-y border-rule">
      {hooks.map((hook) => {
        const angle = hook.angle_id === null ? undefined : anglesById.get(hook.angle_id)
        const used = hook.used_at !== null
        const generated = hook.source === 'generated'
        const beats =
          used || hook.outline === null
            ? []
            : hook.outline
                .split('\n')
                .map((line) => stripMarker(line))
                .filter((line) => line !== '')
        return (
          <li key={hook.id}>
            <button
              type="button"
              onClick={() => void onToggle(hook)}
              aria-pressed={used}
              className="press flex w-full gap-3 py-3.5 text-left active:bg-surface"
            >
              <span
                aria-hidden
                className={`mt-1 flex size-5 shrink-0 items-center justify-center rounded-md border ${
                  used ? 'border-state-posted text-state-posted' : 'border-edge-lit'
                }`}
              >
                {used ? <CheckIcon className="draw-check h-4 w-4" strokeWidth={2.25} /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-lg leading-snug ${used ? 'text-state-later line-through decoration-state-later/60' : 'text-text'}`}
                >
                  {hook.body}
                </span>
                {beats.length > 0 ? (
                  <ol className="mt-2 flex flex-col gap-1 border-l border-edge-lit pl-3">
                    {beats.map((beat) => (
                      <li key={beat} className="meta text-text-dim">
                        {beat}
                      </li>
                    ))}
                  </ol>
                ) : null}
                {generated || angle ? (
                  <span className="mt-2 block label text-state-later">
                    {[
                      generated ? 'generated' : null,
                      angle ? `${angle.label}${angle.family === null ? '' : ` - ${angle.family}`}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
