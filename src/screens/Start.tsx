// The onboarding quiz. Everyone answers it once - every student, and him -
// and the planner sends them here until they have a week saved. Also how the
// week is edited later (Setup -> Edit my plan).
//
//   1. Why three days       - recording every day is how you burn out and end
//                              up posting everything at 11 pm
//   2. Time per day          - 1h, 1.5h, 2h (recommended), 3h (locked in)
//   3. The week              - a calendar: three recording sessions at a
//                              reserved time, ideate days, an optional backup
//   4. About you             - name, time zone, goal, one thing to improve
//   5. Review                - the week as it will run; "Looks good" saves it

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { RoadmapWelcome } from '../components/RoadmapWelcome'
import { WeekCalendar } from '../components/WeekCalendar'
import { INPUT_CLASS } from '../components/styles'
import { Button, ScreenHeader, SectionLabel } from '../components/ui'
import { useData } from '../data/useData'
import {
  KIND_LABEL,
  MINUTES_PER_DAY_OPTIONS,
  RECOMMENDED_MINUTES,
  SEGMENT_LABEL,
  WEEKDAYS,
  clock,
  hours,
  planIcs,
  planProblems,
  segmentsFor,
  type DraftBlock,
} from '../data/weeklyPlan'
import { sendQuizFinished } from '../sync/quizFinished'

type Step = 'why' | 'hours' | 'week' | 'you' | 'review'
const STEPS: Step[] = ['why', 'hours', 'week', 'you', 'review']

const MINUTE_LABEL: Record<number, string> = {
  60: '1 hour',
  90: '1.5 hours',
  120: '2 hours · recommended',
  180: "3 hours · if you're really locked in",
}

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto'
  } catch {
    return 'America/Toronto'
  }
}

function timezones(current: string): string[] {
  try {
    const all = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
    return all.includes(current) ? all : [current, ...all]
  } catch {
    return [current]
  }
}

/** The week in words, one line a block - the review screen and his Telegram. */
export function weekLines(blocks: readonly DraftBlock[]): string[] {
  return [...blocks]
    .sort((a, b) => a.weekday - b.weekday || a.start_minute - b.start_minute)
    .map((b) => {
      const what =
        b.kind === 'record'
          ? segmentsFor(b, blocks).map((s) => `${hours(s.duration_minutes)} ${SEGMENT_LABEL[s.kind]}`).join(', then ')
          : `${hours(b.duration_minutes)} ${KIND_LABEL[b.kind]}`
      return `${WEEKDAYS[b.weekday]} ${clock(b.start_minute)} - ${what}`
    })
}

export function Start() {
  const data = useData()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('why')
  const [minutes, setMinutes] = useState<number>(RECOMMENDED_MINUTES)
  const [blocks, setBlocks] = useState<DraftBlock[]>([])
  const [name, setName] = useState('')
  const [timezone, setTimezone] = useState(browserTimezone)
  const [goal, setGoal] = useState('')
  const [wish, setWish] = useState('')
  const [firstTime, setFirstTime] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Editing an existing plan starts from it.
  useEffect(() => {
    let cancelled = false
    void Promise.all([data.listPlanBlocks(), data.getUserSettings()]).then(([saved, settings]) => {
      if (cancelled) return
      if (saved.length > 0) {
        setBlocks(saved.map(({ kind, weekday, start_minute, duration_minutes }) => ({ kind, weekday, start_minute, duration_minutes })))
        setFirstTime(false)
      }
      if (settings.minutes_per_day) setMinutes(settings.minutes_per_day)
      if (settings.student_name) setName(settings.student_name)
      if (settings.timezone) setTimezone(settings.timezone)
      if (settings.goal) setGoal(settings.goal)
      if (settings.wish) setWish(settings.wish)
    })
    return () => {
      cancelled = true
    }
  }, [data])

  const problems = useMemo(() => planProblems(blocks), [blocks])
  const index = STEPS.indexOf(step)
  const next = () => setStep(STEPS[index + 1])
  const back = () => setStep(STEPS[Math.max(0, index - 1)])

  function changeMinutes(value: number) {
    setMinutes(value)
    // Sessions already placed take the new length.
    setBlocks((current) => current.map((b) => (b.kind === 'ideate' ? b : { ...b, duration_minutes: value })))
  }

  function downloadIcs() {
    const url = URL.createObjectURL(new Blob([planIcs(blocks, timezone)], { type: 'text/calendar' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'my-ugc-week.ics'
    link.click()
    URL.revokeObjectURL(url)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await data.replacePlanBlocks(blocks)
      const before = await data.getUserSettings()
      await data.updateUserSettings({
        student_name: name.trim(),
        timezone,
        goal: goal.trim(),
        wish: wish.trim() || null,
        minutes_per_day: minutes,
        onboarded_at: before.onboarded_at ?? new Date().toISOString(),
      })
      if (before.onboarded_at === null) {
        void sendQuizFinished({ name: name.trim(), timezone, goal: goal.trim(), wish: wish.trim(), minutesPerDay: minutes, week: weekLines(blocks) })
      }
      void navigate('/', { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  const nav = (canGo: boolean, label = 'Next') => (
    <div className="flex items-center gap-2 pt-2">
      {index > 0 ? (
        <Button variant="ghost" onClick={back}>
          Back
        </Button>
      ) : null}
      <Button variant="now" disabled={!canGo} onClick={next}>
        {label}
      </Button>
    </div>
  )

  // The welcome is a cover page of its own, edge to edge.
  if (step === 'why') return <RoadmapWelcome onStart={next} editing={!firstTime} />

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <p className="label text-state-later">
        Step {index + 1} of {STEPS.length}
      </p>

      {step === 'hours' ? (
        <>
          <ScreenHeader title="How long is each recording day?" meta="The more time, the faster you scale." />
          <div role="radiogroup" aria-label="Time per recording day" className="flex flex-col gap-2">
            {MINUTES_PER_DAY_OPTIONS.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={minutes === value}
                onClick={() => changeMinutes(value)}
                className={[
                  'press min-h-tap rounded-xl border px-4 py-3 text-left',
                  minutes === value ? 'border-state-now bg-surface-raised text-text' : 'border-edge text-text-dim active:bg-surface',
                ].join(' ')}
              >
                <span className="block text-base font-semibold">{MINUTE_LABEL[value]}</span>
                <span className="meta block text-state-later">
                  {hours(value >= 120 ? 60 : value / 2)} Trybe videos + {hours(value - (value >= 120 ? 60 : value / 2))} base UGC or media maxing
                  · {hours(value * 3)} a week
                </span>
              </button>
            ))}
          </div>
          {nav(true)}
        </>
      ) : null}

      {step === 'week' ? (
        <>
          <ScreenHeader title="Place your week" meta="Your three recording sessions, your ideate days, and a backup day if you want one." />
          <WeekCalendar blocks={blocks} minutesPerDay={minutes} onChange={setBlocks} />
          {problems.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {problems.map((p) => (
                <li key={p} className="text-sm text-state-later">
                  {p}
                </li>
              ))}
            </ul>
          ) : null}
          {nav(problems.length === 0)}
        </>
      ) : null}

      {step === 'you' ? (
        <>
          <ScreenHeader title="About you" />
          <label className="flex flex-col gap-1">
            <span className="label text-state-later">Your name</span>
            <input className={INPUT_CLASS} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label text-state-later">Time zone</span>
            <select className={INPUT_CLASS} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {timezones(timezone).map((tz) => (
                <option key={tz} value={tz}>
                  {tz.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="label text-state-later">Your goal</span>
            <input
              className={INPUT_CLASS}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. land my first campaign, $1k a month"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label text-state-later">If there was one thing we could do to make your experience as good as possible, what would it be?</span>
            <textarea className={`${INPUT_CLASS} min-h-24 py-2`} value={wish} onChange={(e) => setWish(e.target.value)} />
          </label>
          {nav(name.trim() !== '' && goal.trim() !== '')}
        </>
      ) : null}

      {step === 'review' ? (
        <>
          <ScreenHeader title="Your week" meta={`${hours(minutes)} a recording day · ${timezone.replace(/_/g, ' ')}`} />
          <WeekCalendar blocks={blocks} minutesPerDay={minutes} readOnly />
          <ul className="flex flex-col divide-y divide-rule border-y border-rule">
            {weekLines(blocks).map((line) => (
              <li key={line} className="py-2 text-base text-text">
                {line}
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2">
            <SectionLabel>Your calendar</SectionLabel>
            <p className="text-sm text-text-dim">* I recommend you put this in your own Google Calendar. It can help you.</p>
            <Button variant="ghost" className="self-start" onClick={downloadIcs}>
              Add to my calendar (.ics)
            </Button>
          </div>
          {error ? <p className="text-sm text-state-blocked">{error}</p> : null}
          <div className="flex items-center gap-2 pt-2">
            <Button variant="ghost" onClick={back}>
              Back
            </Button>
            <Button variant="now" disabled={saving || problems.length > 0} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Looks good'}
            </Button>
          </div>
        </>
      ) : null}
    </section>
  )
}
