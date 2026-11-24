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

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { RoadmapWelcome } from '../components/RoadmapWelcome'
import { CalendarIcon } from '../components/icons'
import {
  ChoiceCard,
  Field,
  GhostButton,
  HIGHLIGHT,
  Heading,
  INPUT,
  INPUT_STYLE,
  PrimaryButton,
  R,
  RoadmapPage,
  StepNav,
  TextInput,
  cardStyle,
} from '../components/roadmap'
import { WeekCalendar } from '../components/WeekCalendar'
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
  trybeMinutes,
  type DraftBlock,
} from '../data/weeklyPlan'
import { sendQuizFinished } from '../sync/quizFinished'

type Step = 'why' | 'hours' | 'week' | 'you' | 'review'
const STEPS: Step[] = ['why', 'hours', 'week', 'you', 'review']

const MINUTE_TITLE: Record<number, string> = { 60: '1 hour', 90: '1.5 hours', 120: '2 hours', 180: '3 hours' }
const MINUTE_BADGE: Record<number, string | undefined> = { 120: 'Recommended', 180: "If you're really locked in" }

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

  // Leaving: first time, a way to sign in instead (a week saved on another
  // device arrives once he does); changing it later, a way back out.
  const aside = firstTime ? (
    <Link to="/settings" className="hidden text-[13px] font-semibold transition-colors hover:text-[#F4F3EF] sm:inline" style={{ color: R.dim }}>
      Sign in
    </Link>
  ) : (
    <Link to="/settings" className="text-[13px] font-semibold transition-colors hover:text-[#F4F3EF]" style={{ color: R.dim }}>
      Cancel
    </Link>
  )

  // The welcome is a cover page of its own; the four questions are steps 1-4.
  if (step === 'why') return <RoadmapWelcome onStart={next} editing={!firstTime} aside={aside} />
  const stepNumber = index
  const total = STEPS.length - 1
  const kicker = (label: string) => `Step ${String(stepNumber).padStart(2, '0')} · ${label}`

  return (
    <RoadmapPage step={stepNumber} steps={total} aside={aside}>
      <div key={step} className="flex flex-col gap-8 pt-10 sm:pt-14">
        {step === 'hours' ? (
          <>
            <Heading kicker={kicker('Your time')} title="How long is each recording day?" lead="The more time you give it, the faster you scale. Every session starts with Trybe videos." />
            <div role="radiogroup" aria-label="Time per recording day" className="flex flex-col gap-3">
              {MINUTES_PER_DAY_OPTIONS.map((value, i) => {
                const trybe = trybeMinutes(value)
                return (
                  <ChoiceCard
                    key={value}
                    index={i}
                    selected={minutes === value}
                    onSelect={() => changeMinutes(value)}
                    title={MINUTE_TITLE[value]}
                    badge={MINUTE_BADGE[value]}
                  >
                    <span className="flex items-center gap-3">
                      {/* The split, drawn: Trybe first, then the rest. */}
                      <span aria-hidden className="flex h-1.5 w-24 shrink-0 overflow-hidden rounded-full" style={{ background: R.edge }}>
                        <span style={{ width: `${(trybe / value) * 100}%`, background: R.blue }} />
                        <span style={{ width: `${((value - trybe) / value) * 100}%`, background: '#3B5BDB' }} />
                      </span>
                      <span className="text-[13.5px]" style={{ color: R.body }}>
                        {hours(trybe)} Trybe + {hours(value - trybe)} base UGC or media maxing · {hours(value * 3)} a week
                      </span>
                    </span>
                  </ChoiceCard>
                )
              })}
            </div>
            <StepNav onBack={back} next={<PrimaryButton onClick={next}>Next</PrimaryButton>} />
          </>
        ) : null}

        {step === 'week' ? (
          <>
            <Heading
              kicker={kicker('Your week')}
              title="Place your week"
              lead="Your three recording sessions at the time you reserve for them, your ideate days, and a backup day if you want one."
            />
            <WeekCalendar blocks={blocks} minutesPerDay={minutes} onChange={setBlocks} />
            {problems.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {problems.map((p) => (
                  <li key={p} className="flex items-center gap-3 text-[14px]" style={{ color: R.body }}>
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: R.line }} />
                    {p}
                  </li>
                ))}
              </ul>
            ) : null}
            <StepNav onBack={back} next={<PrimaryButton disabled={problems.length > 0} onClick={next}>Next</PrimaryButton>} />
          </>
        ) : null}

        {step === 'you' ? (
          <>
            <Heading kicker={kicker('About you')} title="Tell us about you" lead="So we know who you are and what you're working toward." />
            <div className="flex flex-col gap-5 rounded-2xl p-5 sm:p-6" style={cardStyle(false)}>
              <Field label="Your name">{({ id }) => <TextInput id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}</Field>
              <Field label="Time zone" hint="Filled in from your phone - change it if it's wrong.">
                {({ id }) => (
                  <select id={id} className={`${INPUT} h-12 appearance-none`} style={INPUT_STYLE} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                    {timezones(timezone).map((tz) => (
                      <option key={tz} value={tz}>
                        {tz.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Your goal">
                {({ id }) => <TextInput id={id} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. land my first campaign, $1k a month" />}
              </Field>
              <Field label="If there was one thing we could do to make your experience as good as possible, what would it be?">
                {({ id }) => <textarea id={id} className={`${INPUT} min-h-28 py-3`} style={INPUT_STYLE} value={wish} onChange={(e) => setWish(e.target.value)} />}
              </Field>
            </div>
            <StepNav onBack={back} next={<PrimaryButton disabled={name.trim() === '' || goal.trim() === ''} onClick={next}>Next</PrimaryButton>} />
          </>
        ) : null}

        {step === 'review' ? (
          <>
            <Heading kicker={kicker('Review')} title="Your week" lead={`${hours(minutes)} a recording day · ${timezone.replace(/_/g, ' ')}`} />
            <WeekCalendar blocks={blocks} minutesPerDay={minutes} readOnly />
            {/* The deck's rows: dark bars, a blue number, bold white name, grey text. */}
            <ol className="flex flex-col gap-2">
              {sortedBlocks(blocks).map((b, i) => (
                <li
                  key={`${b.weekday}-${b.start_minute}`}
                  className="settle-in flex items-center gap-4 rounded-2xl px-4 py-3.5"
                  style={{ ...cardStyle(false), '--i': i } as CSSProperties}
                >
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold"
                    style={b.kind === 'record' ? { background: HIGHLIGHT, color: '#fff' } : { background: 'rgba(134,168,255,0.10)', color: R.blue, boxShadow: 'inset 0 0 0 1px rgba(134,168,255,0.28)' }}
                  >
                    {WEEKDAYS[b.weekday].slice(0, 2)}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[15px] font-semibold" style={{ color: R.title }}>
                      {WEEKDAYS[b.weekday]} · {clock(b.start_minute)}
                    </span>
                    <span className="text-[13.5px]" style={{ color: R.body }}>
                      {describe(b, blocks)}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
            <div className="flex flex-col gap-4 rounded-2xl p-5 sm:flex-row sm:items-center" style={cardStyle(false)}>
              <span
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center rounded-full"
                style={{ background: 'rgba(134,168,255,0.10)', color: R.blue, boxShadow: 'inset 0 0 0 1px rgba(134,168,255,0.28)' }}
              >
                <CalendarIcon className="h-5 w-5" />
              </span>
              <p className="flex-1 text-[14px] leading-relaxed" style={{ color: R.body }}>
                * I recommend you put this in your own Google Calendar. It can help you.
              </p>
              <GhostButton onClick={downloadIcs}>Add to my calendar (.ics)</GhostButton>
            </div>
            {error ? (
              <p className="text-[14px]" style={{ color: '#F2564C' }}>
                {error}
              </p>
            ) : null}
            <StepNav
              onBack={back}
              next={
                <PrimaryButton disabled={saving || problems.length > 0} onClick={() => void save()}>
                  {saving ? 'Saving…' : 'Looks good'}
                </PrimaryButton>
              }
            />
          </>
        ) : null}
      </div>
    </RoadmapPage>
  )
}

function sortedBlocks(blocks: readonly DraftBlock[]): DraftBlock[] {
  return [...blocks].sort((a, b) => a.weekday - b.weekday || a.start_minute - b.start_minute)
}

/** What a block holds, in words: "1h Trybe videos, then 1h Media maxing". */
function describe(b: DraftBlock, blocks: readonly DraftBlock[]): string {
  return b.kind === 'record'
    ? segmentsFor(b, blocks).map((s) => `${hours(s.duration_minutes)} ${SEGMENT_LABEL[s.kind]}`).join(', then ')
    : `${hours(b.duration_minutes)} ${KIND_LABEL[b.kind]}`
}
