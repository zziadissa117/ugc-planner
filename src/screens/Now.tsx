// TODAY - the home screen.
//
// He signed in and "nothing happens": the home screen was a FILM and a POST
// tile, a dictation list and a wall of warm-up accounts, none of which said
// what today was for. It now opens on today off the week he placed in the quiz
// - the session on now, or the next one - and the things a recording day
// needs:
//
//   - today's sessions at their times, the one on now lit
//   - the Trybe timer, with "+1 video" and today's and this week's count
//   - how today's posts stand, one tap from POST
//   - a plain countdown, used for warm-ups
//   - a way into hooks for each campaign
//   - the week, as a calendar, with a way to change it
//
// Gone, deleted rather than left dark: the FILM console, the FILM and POST
// tiles, the "Mark edited" button, the per-account warm-up queue and its "All
// accounts" list, the dictated to-do list and the work clock.

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { ChevronRightIcon, SparkIcon } from '../components/icons'
import { TrybeTimer, WarmupCountdown } from '../components/TodayTimers'
import { WeekCalendar } from '../components/WeekCalendar'
import { Card, ScreenHeader, SectionLabel, StateDot } from '../components/ui'
import { CARD_CLASS, buttonClass } from '../components/styles'
import type { Campaign, PlanBlock } from '../data'
import { localToday } from '../data'
import { ensureTodaysQuota, summariseToday } from '../data/today'
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
import { hookGenerationAvailable } from '../hooks/generateHooks'
import { inPostOrder } from '../money'
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

  // Today's obligation is raised as rows before anything is counted - the
  // same first step the Post screen takes - so the posts line is never
  // briefly wrong. Read again when the day turns over.
  const [snapshot] = useLoaded(async () => {
    await ensureTodaysQuota(data, day)
    const [blocks, settings, campaigns, accounts, videos, posts] = await Promise.all([
      data.listPlanBlocks(),
      data.getUserSettings(),
      data.listCampaigns(),
      data.listCampaignAccounts(),
      data.listVideos(),
      data.listAllVideoPosts(),
    ])
    return { blocks, settings, campaigns, accounts, videos, posts }
  }, [data, day])

  if (!snapshot) return null
  const { blocks, settings, campaigns, accounts, videos, posts } = snapshot

  const sessions = sessionsToday(blocks, now)
  const recordingNow = sessions.some((s) => s.state === 'now' && s.block.kind === 'record')
  // The length he picked in the quiz. A week saved before that was asked has
  // it on its recording blocks instead.
  const minutesPerDay =
    settings.minutes_per_day ?? blocks.find((b) => b.kind === 'record')?.duration_minutes ?? RECOMMENDED_MINUTES
  // The same figure the Post tab is built from (summariseToday reads its
  // boards), so the two screens cannot disagree.
  const { posted, owed } = summariseToday(campaigns, accounts, videos, posts, day)

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <ScreenHeader
        kicker="Today"
        title={headline(sessions)}
        meta={now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
      />

      <TodaySessions blocks={blocks} sessions={sessions} now={now} />

      <TrybeTimer minutes={trybeMinutes(minutesPerDay)} now={now} lit={recordingNow} />

      <PostsToday posted={posted} owed={owed} />

      <WarmupCountdown />

      <Hooks campaigns={inPostOrder(campaigns, accounts)} />

      <section className="flex flex-col gap-3" aria-label="Your week">
        <SectionLabel
          trailing={
            <Link to="/start" className="text-brand transition-colors duration-200 hover:text-text">
              Edit my week
            </Link>
          }
        >
          Your week
        </SectionLabel>
        <WeekCalendar blocks={blocks} minutesPerDay={minutesPerDay} readOnly />
      </section>
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

/** How today's posts stand - the Post tab's own count, summed. Green once
 *  the day is filled, the same state the boxes use. */
function PostsToday({ posted, owed }: { posted: number; owed: number }) {
  const done = owed > 0 && posted >= owed
  return (
    <Link
      to="/post"
      className={`${CARD_CLASS} press group flex min-h-tap items-center justify-between gap-4 px-5 py-3 transition-colors duration-200 hover:border-edge-lit`}
    >
      <span className="text-base font-semibold text-text">Posts</span>
      <span className="flex min-w-0 items-center gap-2">
        {owed === 0 && posted === 0 ? (
          <span className="meta text-state-later">Nothing owed today</span>
        ) : (
          <span className="numeric text-lg">
            <span className={`font-semibold ${done ? 'text-state-posted' : 'text-text'}`}>{posted}</span>
            <span className="text-state-later">{owed > 0 ? ` of ${owed}` : ''} posted today</span>
          </span>
        )}
        <ChevronRightIcon className="h-4 w-4 shrink-0 text-brand transition-transform duration-200 group-hover:translate-x-0.5" />
      </span>
    </Link>
  )
}

/** A way into each campaign's hooks. Writing and generating them happens on
 *  the campaign's page. */
function Hooks({ campaigns }: { campaigns: Campaign[] }) {
  const generate = hookGenerationAvailable()
  return (
    <section className="flex flex-col gap-3" aria-label="Hooks">
      <SectionLabel>Hooks</SectionLabel>
      {campaigns.length === 0 ? (
        <Card className="flex flex-col items-start gap-3 p-5">
          <p className="text-base text-text-dim">No campaigns yet.</p>
          <Link to="/campaigns/new" className={buttonClass('quiet', 'small')}>
            Add a campaign
          </Link>
        </Card>
      ) : (
        <Card className="px-5">
          <ul className="flex flex-col divide-y divide-rule">
            {campaigns.map((campaign) => (
              <li key={campaign.id}>
                <Link
                  to={`/campaigns/${campaign.id}#hooks`}
                  className="press group flex min-h-tap items-center justify-between gap-3 py-2"
                >
                  <span className="min-w-0 truncate text-base font-semibold text-text">{campaign.name}</span>
                  <span className="flex shrink-0 items-center gap-1.5 text-text-dim transition-colors duration-200 group-hover:text-text">
                    {generate ? <SparkIcon className="h-4 w-4" /> : null}
                    <span className="meta">{generate ? 'Generate hooks' : 'Write hooks'}</span>
                    <ChevronRightIcon className="h-4 w-4 text-brand transition-transform duration-200 group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  )
}
