// The two countdowns on TODAY.
//
//   TrybeTimer       Trybe videos - videos sent to brands, no account to make.
//                    A timer as long as the Trybe part of his recording day
//                    (an hour on a 2h day), a "+1 video" for each one he makes,
//                    and today's and this week's count. Every tap is a row
//                    (trybe_videos); the counts are counted from those rows,
//                    never kept as a number.
//   WarmupCountdown  A plain countdown he sets, used for warm-ups. It used to
//                    be one timer per account with a queue walking them; now
//                    it is a length and a clock.
//
// Both run in the app shell (warmupTimers.tsx), so leaving the screen,
// reloading or putting the phone down does not lose them, and both chime once
// when the time is up.

import { useCallback, useState, type ReactNode } from 'react'

import { hours } from '../data/weeklyPlan'
import { useData } from '../data/useData'
import { useLoaded } from '../data/useLoaded'
import { dayBounds, weekBounds } from '../todaySchedule'
import { formatClock, isFinished, secondsLeft, type CountdownRecord } from '../warmupTimer'
import { useTimers } from '../warmupTimers'
import { PlusIcon } from './icons'
import { Button, Card, SectionLabel } from './ui'

/** What the countdown reads, and in which state colour: grey before it
 *  starts, white while it runs, green once the time is up. */
function readout(timer: CountdownRecord | undefined, now: number, minutes: number) {
  if (!timer) return { left: minutes * 60, total: minutes * 60, tone: 'text-state-later', running: false, done: false }
  const done = isFinished(timer, now)
  return {
    left: secondsLeft(timer, now),
    total: timer.minutes * 60,
    tone: done ? 'text-state-posted' : 'text-state-now',
    running: !done,
    done,
  }
}

/** How much of the time is gone, as a thin line - white while it runs,
 *  green when it is up. */
function CountdownBar({ left, total, done }: { left: number; total: number; done: boolean }) {
  return (
    <div aria-hidden className="h-1 overflow-hidden rounded-full bg-rule">
      <div
        className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${done ? 'bg-state-posted' : 'bg-state-now/80'}`}
        style={{ width: `${total > 0 ? ((total - left) / total) * 100 : 100}%` }}
      />
    </div>
  )
}

/** A count, or a dot until the rows have been read - never a 0 that turns
 *  out not to be true a moment later. */
function Figure({ value, label }: { value: number | null; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      {/* Keyed on the count, so each new one lands with the tick's pop. */}
      <span
        key={value ?? 'reading'}
        className={`numeric text-4xl font-semibold leading-none ${value === null ? 'text-state-later' : 'pop-in text-text'}`}
        aria-hidden
      >
        {value ?? '·'}
      </span>
      <span className="label text-state-later" aria-hidden>
        {label}
      </span>
      {value === null ? null : <span className="sr-only">{`${label}: ${value}`}</span>}
    </div>
  )
}

export function TrybeTimer({ minutes, now, lit }: { minutes: number; now: Date; lit: boolean }) {
  const data = useData()
  const timers = useTimers()
  const timer = timers.timers.find((t) => t.kind === 'trybe')
  const clock = readout(timer, timers.now, minutes)
  const [undoing, setUndoing] = useState(false)

  const day = dayBounds(now)
  const week = weekBounds(now)
  const dayStart = day.from.getTime()
  const weekStart = week.from.getTime()
  const weekEnd = week.to.getTime()
  // Read again when the week turns over, and after every tap.
  const [rows, reload] = useLoaded(
    () => data.listTrybeVideos({ from: new Date(weekStart).toISOString(), to: new Date(weekEnd).toISOString() }),
    [data, weekStart, weekEnd],
  )
  const thisWeek = rows ?? []
  const today = thisWeek.filter((row) => Date.parse(row.made_at) >= dayStart && Date.parse(row.made_at) < day.to.getTime())
  const last = today.at(-1)

  const plusOne = useCallback(async () => {
    await data.logTrybeVideo()
    await reload()
  }, [data, reload])

  const undo = useCallback(async () => {
    if (!last) return
    setUndoing(true)
    try {
      await data.undoTrybeVideo(last.id)
      await reload()
    } finally {
      setUndoing(false)
    }
  }, [data, last, reload])

  // Lit while a recording session is on, or while its timer is running:
  // white is "do this now".
  const doThisNow = lit || clock.running

  return (
    <Card className={`flex flex-col gap-5 p-5 sm:p-6 ${doThisNow ? '!border-state-now/45' : ''}`} aria-label="Trybe videos" role="region">
      <SectionLabel trailing={`${hours(clock.total / 60)} timer`}>Trybe videos</SectionLabel>

      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="flex flex-col gap-2">
          <p
            className={`numeric font-semibold leading-none ${clock.tone}`}
            style={{ fontSize: 'clamp(3rem, 15vw, 4.5rem)' }}
            aria-label={clock.done ? "Time's up" : `${formatClock(clock.left)} left`}
          >
            {formatClock(clock.left)}
          </p>
          <p className="meta text-text-dim">
            {clock.done
              ? "Time's up."
              : clock.running
                ? 'Tap +1 for every video you make.'
                : 'Start the timer and make as many as you can.'}
          </p>
        </div>
        {clock.running ? (
          <Button variant="ghost" size="small" onClick={() => timers.stop('trybe')}>
            Stop timer
          </Button>
        ) : clock.done ? (
          <Button size="small" onClick={() => timers.stop('trybe')}>
            Done
          </Button>
        ) : (
          <Button variant={lit ? 'now' : 'quiet'} onClick={() => timers.start('trybe', minutes)}>
            Start {hours(minutes)} timer
          </Button>
        )}
      </div>

      {timer ? <CountdownBar left={clock.left} total={clock.total} done={clock.done} /> : null}

      <Button variant={clock.running ? 'now' : 'quiet'} size="big" onClick={() => void plusOne()} aria-label="+1 video">
        <PlusIcon className="h-6 w-6" strokeWidth={2} />1 video
      </Button>

      <div className="flex items-end justify-between gap-4">
        <div className="flex gap-10">
          <Figure value={rows === null ? null : today.length} label="Today" />
          <Figure value={rows === null ? null : thisWeek.length} label="This week" />
        </div>
        {last ? (
          <Button variant="ghost" size="small" onClick={() => void undo()} disabled={undoing}>
            Undo last
          </Button>
        ) : null}
      </div>
    </Card>
  )
}

/** Lengths offered for a warm-up, in minutes. A tap starts it. */
const WARMUP_PRESETS = [5, 10, 15, 30] as const

export function WarmupCountdown() {
  const timers = useTimers()
  const timer = timers.timers.find((t) => t.kind === 'warmup')
  const clock = readout(timer, timers.now, 0)

  let body: ReactNode
  if (timer) {
    body = (
      <>
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <p
              className={`numeric font-semibold leading-none ${clock.tone}`}
              style={{ fontSize: 'clamp(2.5rem, 12vw, 3.25rem)' }}
              aria-label={clock.done ? "Time's up" : `${formatClock(clock.left)} left`}
            >
              {formatClock(clock.left)}
            </p>
            <p className="meta text-text-dim">{clock.done ? "Time's up." : `${timer.minutes} min`}</p>
          </div>
          <Button variant={clock.done ? 'quiet' : 'ghost'} size="small" onClick={() => timers.stop('warmup')}>
            {clock.done ? 'Done' : 'Stop'}
          </Button>
        </div>
        <CountdownBar left={clock.left} total={clock.total} done={clock.done} />
      </>
    )
  } else {
    body = (
      <div className="grid grid-cols-4 gap-2">
        {WARMUP_PRESETS.map((minutes) => (
          <button
            key={minutes}
            type="button"
            onClick={() => timers.start('warmup', minutes)}
            aria-label={`Start a ${minutes} minute timer`}
            className="press flex min-h-[3.75rem] flex-col items-center justify-center rounded-xl border border-edge bg-white/[0.02] text-text-dim transition-colors duration-200 hover:border-edge-lit hover:bg-white/[0.05] hover:text-text"
          >
            <span className="numeric text-xl font-semibold leading-none">{minutes}</span>
            <span className="mt-1 text-xs leading-none">min</span>
          </button>
        ))}
      </div>
    )
  }

  return (
    <Card className="flex flex-col gap-4 p-5 sm:p-6" aria-label="Timer" role="region">
      <SectionLabel trailing="Used for warm-ups">Timer</SectionLabel>
      {body}
    </Card>
  )
}
