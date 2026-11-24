// The onboarding quiz. Everyone answers it once - every student, and him -
// and the planner sends them here until they have a week saved. Also how the
// week is edited later (Setup -> Edit my recording week).
//
//   Welcome             - why three days, and Trybe first
//   1. Time per day     - 1h, 1.5h, 2h (recommended), 3h (locked in)
//   2. The week         - a calendar, Sunday first: three recording sessions at
//                         a reserved time, 2-4h of ideating on other days, an
//                         optional backup
//   3. About you        - name, goal, one thing to improve; time zone
//   4. Review           - the week as it will run
//   5. Your account     - only when signed out. The account is made (or signed
//                         into) at the end, and the week is saved once it
//                         exists (src/sync/onboardingDraft.ts). Signed in,
//                         "Looks good" on the review saves it there and then.

import { useContext, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { RoadmapWelcome } from '../components/RoadmapWelcome'
import { CalendarIcon, CheckIcon } from '../components/icons'
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
  Spot,
  StepNav,
  TextInput,
  cardStyle,
} from '../components/roadmap'
import { WeekCalendar } from '../components/WeekCalendar'
import { DATA_CHANGED_EVENT } from '../data/changed'
import { useData } from '../data/useData'
import {
  MINUTES_PER_DAY_OPTIONS,
  RECOMMENDED_MINUTES,
  WEEKDAYS,
  clock,
  describeBlock,
  hours,
  ideateMinutes,
  planIcs,
  planProblems,
  sortByWeek,
  trybeMinutes,
  weekLines,
  type DraftBlock,
} from '../data/weeklyPlan'
import { AuthContext } from '../sync/AuthContext'
import { keepDraft, readDraft, readInvite, type OnboardingDraft } from '../sync/onboardingDraft'
import { sendQuizFinished } from '../sync/quizFinished'

type Step = 'why' | 'hours' | 'week' | 'you' | 'review' | 'account'
const QUIZ: Step[] = ['why', 'hours', 'week', 'you', 'review']
const LONGEST = Math.max(...MINUTES_PER_DAY_OPTIONS)

const MINUTE_TITLE: Record<number, string> = { 60: '1 hour', 90: '1.5 hours', 120: '2 hours', 180: '3 hours' }
const MINUTE_BADGE: Record<number, string | undefined> = { 120: 'Recommended', 180: "If you're really locked in" }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

export function Start() {
  const data = useData()
  const navigate = useNavigate()
  // Read directly rather than through useAuth: the quiz also renders with no
  // sign-in set up at all (tests, a copy with no server), and then the week
  // simply saves on this device.
  const auth = useContext(AuthContext)
  const [step, setStep] = useState<Step>('why')
  const [minutes, setMinutes] = useState<number>(RECOMMENDED_MINUTES)
  const [blocks, setBlocks] = useState<DraftBlock[]>([])
  const [name, setName] = useState('')
  const [timezone, setTimezone] = useState(browserTimezone)
  const [goal, setGoal] = useState('')
  const [wish, setWish] = useState('')
  const [firstTime, setFirstTime] = useState(true)
  // Whether the saved week has been looked for yet: until then "first time"
  // is only a guess, and changing a week must not be mistaken for one arriving.
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [changingZone, setChangingZone] = useState(false)
  // The account step: his email, whether he came only to sign in (from the
  // welcome), and whether he asked to change the address a link went to.
  const [email, setEmail] = useState('')
  const [signInOnly, setSignInOnly] = useState(false)
  const [changingEmail, setChangingEmail] = useState(false)
  const [invite] = useState(readInvite)

  // Editing an existing plan starts from it - and a quiz finished before an
  // account was made, from that, rather than from nothing.
  useEffect(() => {
    let cancelled = false
    void Promise.all([data.listPlanBlocks(), data.getUserSettings()]).then(([saved, settings]) => {
      if (cancelled) return
      if (saved.length > 0) {
        setBlocks(saved.map(({ kind, weekday, start_minute, duration_minutes }) => ({ kind, weekday, start_minute, duration_minutes })))
        setFirstTime(false)
      } else {
        const waiting = readDraft()
        if (waiting) {
          setBlocks(waiting.blocks)
          setMinutes(waiting.minutes_per_day)
          setName(waiting.student_name)
          setTimezone(waiting.timezone)
          setGoal(waiting.goal)
          setWish(waiting.wish ?? '')
          return
        }
      }
      if (settings.minutes_per_day) setMinutes(settings.minutes_per_day)
      if (settings.student_name) setName(settings.student_name)
      if (settings.timezone) setTimezone(settings.timezone)
      if (settings.goal) setGoal(settings.goal)
      if (settings.wish) setWish(settings.wish)
    }).finally(() => {
      if (!cancelled) setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [data])

  // A week that arrives while he is here - saved from the quiz he finished
  // before signing in, or pulled from another device - means he is done.
  // Looked for again whenever the sign-in changes too: when the link opened
  // in another tab, that tab saved the week into the same store, and the
  // announcement never reaches this one.
  const signedInAs = auth?.email ?? null
  const waitingOnSetup = auth?.settingUp ?? false
  useEffect(() => {
    if (!loaded || !firstTime) return
    const check = () =>
      void data.listPlanBlocks().then((saved) => {
        if (saved.length > 0) void navigate('/', { replace: true })
      })
    if (signedInAs !== null) check()
    window.addEventListener(DATA_CHANGED_EVENT, check)
    return () => window.removeEventListener(DATA_CHANGED_EVENT, check)
  }, [data, firstTime, loaded, navigate, signedInAs, waitingOnSetup])

  // Signed out on the first go: the account is the last step.
  const signedOut = auth !== null && auth.configured && auth.ready && auth.email === null
  const needsAccount = signedOut && firstTime
  const steps: Step[] = needsAccount ? [...QUIZ, 'account'] : QUIZ
  const problems = useMemo(() => planProblems(blocks), [blocks])
  const index = steps.indexOf(step)
  const next = () => setStep(steps[index + 1])
  const back = () => setStep(steps[Math.max(0, index - 1)])

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

  function draft(): OnboardingDraft {
    return { blocks, student_name: name.trim(), timezone, goal: goal.trim(), wish: wish.trim() || null, minutes_per_day: minutes }
  }

  /** "Looks good": saved now when signed in, or kept for the account step. */
  function finish() {
    if (needsAccount) {
      keepDraft(draft())
      setStep('account')
      return
    }
    void save()
  }

  /** The account step's button: a link that makes the account - carrying the
   *  invite and the finished quiz - or signs into one. */
  function sendLink() {
    if (!auth) return
    const creating = !signInOnly && invite !== null
    setChangingEmail(false)
    void auth.requestLink(email.trim(), creating ? invite : undefined, creating ? draft() : undefined)
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

  // Changing his week later, a way back out. The first time there is none:
  // the account comes at the end, and signing into one is on the welcome.
  const aside = firstTime ? null : (
    <Link to="/settings" className="text-[13px] font-semibold transition-colors hover:text-[#F4F3EF]" style={{ color: R.dim }}>
      Cancel
    </Link>
  )

  // Back from the sign-in link with a finished quiz still to save.
  if (auth?.email && auth.settingUp) {
    return (
      <RoadmapPage>
        <div className="flex flex-col items-center pt-24 sm:pt-32">
          <Heading center kicker="Your account" title="Setting up your planner" lead="Saving your week to your account. This takes a few seconds." />
        </div>
      </RoadmapPage>
    )
  }

  // The welcome is a cover page of its own; the questions are numbered steps.
  if (step === 'why') {
    return (
      <RoadmapWelcome
        onStart={next}
        editing={!firstTime}
        aside={aside}
        onSignIn={
          signedOut && firstTime
            ? () => {
                setSignInOnly(true)
                setStep('account')
              }
            : undefined
        }
      />
    )
  }

  const total = steps.length - 1
  const kicker = (label: string) => `Step ${String(index).padStart(2, '0')} · ${label}`
  // Signing in from the welcome is not a step of the quiz.
  const tracked = !(step === 'account' && signInOnly)
  const creating = !signInOnly && invite !== null
  const sending = auth?.requestStatus === 'sending'
  const sent = auth?.requestStatus === 'sent' && !changingEmail

  return (
    <RoadmapPage step={tracked ? index : undefined} steps={tracked ? total : undefined} aside={aside} wide={step === 'week' || step === 'review'}>
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
                    <span className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                      {/* Drawn to scale against the longest day: 1 hour is a
                          third of 3 hours. Trybe first, then the rest. */}
                      <span aria-hidden className="relative flex h-2 w-full shrink-0 overflow-hidden rounded-full sm:w-44" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        <span style={{ width: `${(trybe / LONGEST) * 100}%`, background: R.blue }} />
                        <span style={{ width: `${((value - trybe) / LONGEST) * 100}%`, background: '#3B5BDB', borderLeft: `2px solid ${R.card}` }} />
                        {[60, 120].map((mark) => (
                          <span key={mark} className="absolute inset-y-0 w-px" style={{ left: `${(mark / LONGEST) * 100}%`, background: 'rgba(10,11,14,0.55)' }} />
                        ))}
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
              lead="Your three recording sessions at the time you reserve for them. Then 2 to 4 hours of ideating on days you don't record, and a backup day if you want one."
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
            <Heading kicker={kicker('About you')} title="About you" />
            <div className="flex flex-col gap-7">
              <Field label="What's your name?">{({ id }) => <TextInput id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}</Field>
              <Field label="What's your goal?">{({ id }) => <TextInput id={id} value={goal} onChange={(e) => setGoal(e.target.value)} />}</Field>
              <Field label="If there was one thing we could do to make your experience as good as possible, what would it be?">
                {({ id }) => <textarea id={id} className={`${INPUT} min-h-28 py-3`} style={INPUT_STYLE} value={wish} onChange={(e) => setWish(e.target.value)} />}
              </Field>
              {changingZone ? (
                <Field label="Time zone">
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
              ) : (
                <p className="text-[14px]" style={{ color: R.dim }}>
                  Time zone: <span style={{ color: R.body }}>{timezone.replace(/_/g, ' ')}</span>{' '}
                  <button type="button" onClick={() => setChangingZone(true)} className="font-semibold underline-offset-4 hover:underline" style={{ color: R.blue }}>
                    Change
                  </button>
                </p>
              )}
            </div>
            <StepNav onBack={back} next={<PrimaryButton disabled={name.trim() === '' || goal.trim() === ''} onClick={next}>Next</PrimaryButton>} />
          </>
        ) : null}

        {step === 'review' ? (
          <>
            <Heading
              kicker={kicker('Review')}
              title="Your week"
              lead={`${hours(minutes)} a recording day · ${hours(ideateMinutes(blocks))} of ideating · ${timezone.replace(/_/g, ' ')}`}
            />
            <WeekCalendar blocks={blocks} minutesPerDay={minutes} readOnly />
            {/* The deck's rows: dark bars, a blue number, bold white name, grey text. */}
            <ol className="flex flex-col gap-2">
              {sortByWeek(blocks).map((b, i) => (
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
                      {describeBlock(b, blocks)}
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
                <PrimaryButton disabled={saving || problems.length > 0} onClick={finish}>
                  {saving ? 'Saving…' : 'Looks good'}
                </PrimaryButton>
              }
            />
          </>
        ) : null}

        {step === 'account' ? (
          auth?.email ? (
            // Signed in from here with no quiz waiting (he came to sign in,
            // and his account has no week yet): on to the quiz.
            <>
              <Heading kicker="Your account" title="You're signed in" lead={`Signed in as ${auth.email}. Now set up your recording week.`} />
              <div>
                <PrimaryButton
                  onClick={() => {
                    setSignInOnly(false)
                    setStep('hours')
                  }}
                >
                  Set up my week
                </PrimaryButton>
              </div>
            </>
          ) : sent ? (
            <>
              <Heading kicker={tracked ? kicker('Your account') : 'Sign in'} title="Check your email" />
              <div className="flex flex-col gap-4 rounded-2xl p-6" style={cardStyle(false)}>
                <Spot>
                  <CheckIcon className="h-5 w-5" strokeWidth={2.25} />
                </Spot>
                <p className="text-[15.5px] leading-relaxed" style={{ color: R.body }}>
                  We sent a link to <span style={{ color: R.title }}>{email.trim()}</span>. Open it on this device and your planner
                  unlocks.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <GhostButton onClick={sendLink}>Send it again</GhostButton>
                  <button
                    type="button"
                    onClick={() => setChangingEmail(true)}
                    className="text-[14px] font-semibold underline-offset-4 hover:underline"
                    style={{ color: R.blue }}
                  >
                    Use a different email
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <Heading
                kicker={tracked ? kicker('Your account') : 'Sign in'}
                title={signInOnly ? 'Welcome back' : creating ? 'Create your account' : 'Sign in to save your week'}
                lead={
                  signInOnly
                    ? "Put in your account's email and we'll send you a link to sign in."
                    : creating
                      ? "Last step. Put in your email and we'll send you a link - open it on this device and your planner unlocks."
                      : "Put in your account's email and we'll send you a link - open it on this device and your planner unlocks. No account yet? You need an invite link to make one."
                }
              />
              <form
                className="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (EMAIL.test(email.trim()) && !sending) sendLink()
                }}
              >
                <Field label="Your email">
                  {({ id }) => <TextInput id={id} type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
                </Field>
                {auth?.requestStatus === 'error' && !changingEmail ? (
                  <p className="text-[14px]" style={{ color: '#FF8A80' }}>
                    {auth.requestError}
                  </p>
                ) : null}
              </form>
              <StepNav
                onBack={
                  signInOnly
                    ? () => {
                        setSignInOnly(false)
                        setStep('why')
                      }
                    : back
                }
                next={
                  <PrimaryButton disabled={!EMAIL.test(email.trim()) || sending} onClick={sendLink}>
                    {sending ? 'Sending…' : creating ? 'Create my account' : 'Send me a link'}
                  </PrimaryButton>
                }
              />
            </>
          )
        ) : null}
      </div>
    </RoadmapPage>
  )
}
