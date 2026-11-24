// TODAY - the home screen, in the order he asked for:
//
//   1. My week        - the week he placed in the quiz, as a calendar, "on
//                       top of everything"
//   2. Going out      - every post Postiz has going out today (or this week),
//                       read only (GoingOut.tsx)
//   3. Today          - the session on now or next, and the day's sessions
//   4. Trybe videos   - the Trybe timer, "+1 video", today's and the week's count
//   5. Timer          - a plain countdown, used for warm-ups
//   6. Hooks          - one button into hook generation (/hooks)
//
// No posts row: "Don't have a Posts button in the Today section. It makes no
// sense." Gone before that, deleted rather than left dark: the FILM console,
// the FILM and POST tiles, the "Mark edited" button, the per-account warm-up
// queue and its "All accounts" list, the dictated to-do list and the work
// clock.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { GoingOut } from '../components/GoingOut'
import { SparkIcon } from '../components/icons'
import { TrybeTimer, WarmupCountdown } from '../components/TodayTimers'
import { WeekCalendar } from '../components/WeekCalendar'
import { Card, ScreenHeader, SectionLabel, StateDot } from '../components/ui'
import { buttonClass } from '../components/styles'
import type { PlanBlock } from '../data'
import { localToday } from '../data'
import { useData } from '../data/useData'
import { useLoaded } from '../data/useLoaded'
import {
  KIND_LABEL,
  RECOMMENDED_MINUTES,
  SEGMENT_LABEL,
  clock,
  describeBlock,
  segmentsFor,
  trybeMinutes,
} from '../data/weeklyPlan'
import {
  describeNext,
  headline,
  minuteOfDay,
  nextSession,
  segmentAt,
  sessionsToday,
  timeRange,
  type TodaySession,
} from '../todaySchedule'
import { useTimers } from '../warmupTimers'

/** The wall clock, re-read every half minute and whenever he comes back to
 *  the tab - enough for a session to go from later to now on its own. */
function useClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = () => setNow(new Date())
    const timer = window.setInterval(tick, 30_000)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('focus', tick)
    }
  }, [])
  return now
}

export function Now() {
  const data = useData()
  const now = useClock()
  const day = localToday(now)

  // Both countdowns are on this screen full size, so the strip the app shell
  // pins to the top of every other screen hides while this one is open.
  const { setOnScreen } = useTimers()
  useEffect(() => {
    setOnScreen(true)
    return () => setOnScreen(false)
  }, [setOnScreen])

  const [snapshot] = useLoaded(async () => {
    const [blocks, settings] = await Promise.all([data.listPlanBlocks(), data.getUserSettings()])
    return { blocks, settings }
  }, [data, day])

  if (!snapshot) return null
  const { blocks, settings } = snapshot

  const sessions = sessionsToday(blocks, now)
  const recordingNow = sessions.some((s) => s.state === 'now' && s.block.kind === 'record')
  // The length he picked in the quiz. A week saved before that was asked has
  // it on its recording blocks instead.
  const minutesPerDay =
    settings.minutes_per_day ?? blocks.find((b) => b.kind === 'record')?.duration_minutes ?? RECOMMENDED_MINUTES

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <section className="flex flex-col gap-3" aria-label="My week">
        <SectionLabel
          trailing={
            <Link to="/start" className="text-brand transition-colors duration-200 hover:text-text">
              Edit my week
            </Link>
          }
        >
          My week
        </SectionLabel>
        <WeekCalendar blocks={blocks} minutesPerDay={minutesPerDay} readOnly />
      </section>

      <GoingOut now={now} />

      <ScreenHeader
        kicker="Today"
        title={headline(sessions)}
        meta={now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
      />

      <TodaySessions blocks={blocks} sessions={sessions} now={now} />

      <TrybeTimer minutes={trybeMinutes(minutesPerDay)} now={now} lit={recordingNow} />

      <WarmupCountdown />

      <HookGeneration />
    </section>
  )
}

/** "in 45 min", "in 2h 10m". */
function startsIn(minutes: number): string {
  if (minutes < 60) return `in ${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `in ${h}h${m > 0 ? ` ${m}m` : ''}`
}

/** Today's sessions at their times. The one on now is white, the ones still
 *  to come grey, and the finished ones fade. With nothing left today, when
 *  the next one is. */
function TodaySessions({ blocks, sessions, now }: { blocks: PlanBlock[]; sessions: TodaySession<PlanBlock>[]; now: Date }) {
  const minute = minuteOfDay(now)
  const anyLeft = sessions.some((s) => s.state !== 'over')
  const next = anyLeft ? null : nextSession(blocks, now)

  return (
    <section className="flex flex-col gap-3" aria-label="Today's sessions">
      <SectionLabel>Sessions</SectionLabel>
      {blocks.length === 0 ? (
        <Card className="flex flex-col items-start gap-3 p-5">
          <p className="text-base text-text-dim">No week saved yet.</p>
          <Link to="/start" className={buttonClass('now', 'small')}>
            Place your week
          </Link>
        </Card>
      ) : (
        <Card className="flex flex-col px-5">
          {sessions.length === 0 ? <p className="py-4 text-base text-text">No session today.</p> : null}
          {sessions.length > 0 ? (
            <ul className="flex flex-col divide-y divide-rule">
              {sessions.map((session) => (
                <SessionRow key={`${session.block.kind}-${session.block.start_minute}`} session={session} blocks={blocks} minute={minute} />
              ))}
            </ul>
          ) : null}
          {next ? (
            <p className={`py-4 text-base text-text-dim ${sessions.length > 0 ? 'border-t border-rule' : '-mt-2 pt-0'}`}>
              Next: <span className="font-semibold text-text">{describeNext(next)}</span>
              <span className="text-state-later"> · {KIND_LABEL[next.block.kind]}</span>
            </p>
          ) : null}
        </Card>
      )}
    </section>
  )
}

function SessionRow({ session, blocks, minute }: { session: TodaySession<PlanBlock>; blocks: PlanBlock[]; minute: number }) {
  const { block, state, end } = session
  const on = state === 'now'
  const what = block.kind === 'record' ? `Record: ${describeBlock(block, blocks)}` : KIND_LABEL[block.kind]

  // During a recording session, which part of it is on and until when.
  let part: string | null = null
  if (on && block.kind === 'record') {
    const segment = segmentAt(block, blocks, minute)
    const after = segmentsFor(block, blocks).find((s) => segment && s.start_minute > segment.start_minute)
    if (segment) {
      part = `${SEGMENT_LABEL[segment.kind]} until ${clock(segment.start_minute + segment.duration_minutes)}${
        after ? `, then ${SEGMENT_LABEL[after.kind]}` : ''
      }`
    }
  }

  return (
    <li className={`flex items-start gap-3 py-4 transition-opacity duration-300 ${state === 'over' ? 'opacity-50' : ''}`}>
      <StateDot tone={on ? 'now' : 'later'} className="mt-2" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex items-baseline justify-between gap-3">
          <span className={`numeric text-lg font-semibold ${on ? 'text-state-now' : 'text-text-dim'}`}>
            {timeRange(block.start_minute, end)}
          </span>
          <span className={`label shrink-0 ${on ? 'text-state-now' : 'text-state-later'}`}>
            {on ? 'Now' : state === 'later' ? startsIn(block.start_minute - minute) : 'Ended'}
          </span>
        </p>
        <p className={`text-base ${on ? 'text-text' : 'text-text-dim'}`}>{what}</p>
        {part ? <p className="meta text-text-dim">{part}</p> : null}
        {on && block.kind === 'ideate' ? (
          <Link to="/ideate" className={`${buttonClass('quiet', 'small')} mt-2 self-start`}>
            Open Ideate
          </Link>
        ) : null}
      </div>
    </li>
  )
}

/** One way into hook generation - not a row per campaign. The campaign is
 *  picked on the Hooks screen. */
function HookGeneration() {
  return (
    <section className="flex flex-col gap-3" aria-label="Hooks">
      <SectionLabel>Hooks</SectionLabel>
      <div>
        <Link to="/hooks" className={buttonClass('quiet')}>
          <SparkIcon className="h-4 w-4" />
          Hook generation
        </Link>
      </div>
    </section>
  )
}
