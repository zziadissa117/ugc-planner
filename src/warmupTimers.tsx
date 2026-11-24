// The countdowns, kept above the routes: the Trybe timer and the plain one
// used for warm-ups.
//
// A timer used to live inside the home screen, so tapping over to Post to
// check something threw it away: "if I leave the page for 2 seconds ... I
// don't want to come back to the Now page and have the timer reset." The
// provider sits in the app shell, which never unmounts while he moves between
// tabs, and the strip it renders is pinned to the top of every other screen.
//
// State is timestamps in localStorage (see warmupTimer.ts), so a countdown
// also survives a reload and is right after the phone was put down for ten
// minutes. When one runs out, the warm-up chime sounds once.
//
// Warm-ups used to be per account here - a timer per account, a queue that
// walked them one after another and recorded each as warmed. He asked for a
// plain countdown instead, so the provider keeps the clock, the chime and the
// strip, and knows nothing about accounts. The name stays: the app shell
// mounts `WarmupTimersProvider`.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'

import { StateDot } from './components/ui'
import { playWarmupDone, unlockAudio } from './sound'
import {
  TIMER_NAME,
  formatClock,
  isFinished,
  readTimers,
  secondsLeft,
  startCountdown,
  writeTimers,
  type CountdownRecord,
  type TimerKind,
} from './warmupTimer'

interface TimersValue {
  /** What is running, or has run out and not been cleared. One of each kind
   *  at most. */
  timers: CountdownRecord[]
  /** The clock every countdown is measured against; ticks once a second
   *  while any exists. */
  now: number
  /** Starts a countdown. One already running is left alone - a second tap
   *  never restarts it; one that has run out is replaced. */
  start: (kind: TimerKind, minutes: number) => void
  /** Stops a countdown, or clears one that has run out. Records nothing. */
  stop: (kind: TimerKind) => void
  /** Whether the screen showing the countdowns full size is open - the strip
   *  hides while it is, rather than showing them twice. */
  setOnScreen: (onScreen: boolean) => void
}

const Context = createContext<TimersValue | null>(null)

export function useTimers(): TimersValue {
  const value = useContext(Context)
  if (value === null) throw new Error('useTimers must be used inside WarmupTimersProvider')
  return value
}

export function WarmupTimersProvider({ children }: { children: ReactNode }) {
  const [timers, setTimers] = useState<CountdownRecord[]>(readTimers)
  const [now, setNow] = useState(() => Date.now())
  const [onScreen, setOnScreen] = useState(false)

  // Written on every change, so what is stored is always what is running.
  useEffect(() => {
    writeTimers(timers)
  }, [timers])

  // One clock for all of them, and only while there is something to count.
  // Starting one sets the clock itself (start), and one read from storage is
  // measured from the moment this mounted.
  useEffect(() => {
    if (timers.length === 0) return
    const tick = window.setInterval(() => setNow(Date.now()), 1000)
    // A backgrounded page throttles its timers, so the moment it is back the
    // clock is re-read rather than waiting for the next tick.
    const wake = () => setNow(Date.now())
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    return () => {
      window.clearInterval(tick)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
    }
  }, [timers.length])

  // A wake-up at the exact moment each countdown ends. A background tab
  // throttles its once-a-second tick, and after a few minutes hidden a browser
  // may run it only about once a minute - so on its own the chime could sound
  // up to a minute late. One timeout set for the end time is not part of that
  // chain.
  useEffect(() => {
    const waits = timers
      .filter((t) => !t.alerted)
      .map((t) => window.setTimeout(() => setNow(Date.now()), Math.max(0, t.endsAt - Date.now()) + 50))
    return () => waits.forEach((id) => window.clearTimeout(id))
  }, [timers])

  // The countdown in the browser tab's own title, so it can be read from
  // another tab or with the window behind another app.
  const baseTitle = useRef<string | null>(null)
  useEffect(() => {
    if (baseTitle.current === null) baseTitle.current = document.title
    const next = [...timers].sort((a, b) => a.endsAt - b.endsAt)[0]
    if (!next) {
      document.title = baseTitle.current
      return
    }
    document.title = isFinished(next, now)
      ? `Time's up - ${TIMER_NAME[next.kind]}`
      : `${formatClock(secondsLeft(next, now))} ${TIMER_NAME[next.kind]}`
  }, [timers, now])

  // The chime, once per countdown. The ref is what guarantees "once": state
  // can lag a render behind, and two ticks in that gap must not ring it twice.
  const chimed = useRef(new Set<string>())
  useEffect(() => {
    const due = timers.filter((t) => !t.alerted && isFinished(t, now) && !chimed.current.has(`${t.kind}:${t.startedAt}`))
    if (due.length === 0) return

    for (const t of due) chimed.current.add(`${t.kind}:${t.startedAt}`)
    playWarmupDone()
    try {
      navigator.vibrate?.([200, 100, 200])
    } catch {
      /* not every device has a motor */
    }
    setTimers((list) =>
      list.map((t) => (due.some((d) => d.kind === t.kind && d.startedAt === t.startedAt) ? { ...t, alerted: true } : t)),
    )
  }, [timers, now])

  const start = useCallback((kind: TimerKind, minutes: number) => {
    // In the tap that starts it, so the chime is allowed to sound later.
    unlockAudio()
    const at = Date.now()
    setTimers((list) => {
      const existing = list.find((t) => t.kind === kind)
      if (existing && !isFinished(existing, at)) return list
      return [...list.filter((t) => t.kind !== kind), startCountdown(kind, minutes, at)]
    })
    setNow(at)
  }, [])

  const stop = useCallback((kind: TimerKind) => {
    setTimers((list) => list.filter((t) => t.kind !== kind))
  }, [])

  const value = useMemo<TimersValue>(() => ({ timers, now, start, stop, setOnScreen }), [timers, now, start, stop])

  return (
    <Context.Provider value={value}>
      {onScreen ? null : <TimerStrip />}
      {children}
    </Context.Provider>
  )
}

/** The strip pinned to the top of every other screen while a countdown runs.
 *
 *  White while it runs, green once the time is up - the two states it can be
 *  in. Tapping it goes back to TODAY, where both live full size. */
function TimerStrip() {
  const { timers, now, stop } = useTimers()
  const navigate = useNavigate()

  if (timers.length === 0) return null
  const shown = [...timers].sort((a, b) => a.endsAt - b.endsAt)

  return (
    <div
      className="sticky top-0 z-40 flex flex-col border-b border-edge/70 bg-ink/85 px-4 backdrop-blur-xl"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
      role="region"
      aria-label="Timers"
    >
      {shown.map((timer) => {
        const done = isFinished(timer, now)
        const total = timer.minutes * 60
        const left = secondsLeft(timer, now)
        const name = TIMER_NAME[timer.kind]
        return (
          <div key={timer.kind} className="relative mx-auto flex w-full max-w-3xl items-center gap-3 py-2">
            <button
              type="button"
              onClick={() => void navigate('/')}
              className="press flex min-h-tap min-w-0 flex-1 items-center justify-between gap-3 text-left"
              aria-label={`Open the ${name} timer`}
            >
              <span className="flex min-w-0 items-center gap-3">
                <StateDot tone={done ? 'posted' : 'now'} />
                <span className="min-w-0">
                  <span className="block truncate text-base font-semibold text-text">{name}</span>
                  <span className="meta block text-state-later">{done ? "Time's up" : `${timer.minutes} min timer`}</span>
                </span>
              </span>
              <span className={`numeric shrink-0 text-2xl font-semibold ${done ? 'text-state-posted' : 'text-text'}`} aria-live="off">
                {formatClock(left)}
              </span>
            </button>
            <button
              type="button"
              onClick={() => stop(timer.kind)}
              aria-label={done ? `Clear the ${name} timer` : `Stop the ${name} timer`}
              className="press min-h-tap shrink-0 rounded-full px-3 text-base text-state-later hover:bg-white/[0.04] hover:text-text"
            >
              {done ? 'Clear' : 'Stop'}
            </button>
            {/* How much of it is gone, as a hairline along the bottom. */}
            <span aria-hidden className="absolute inset-x-0 bottom-0 h-px">
              <span
                className={`block h-px transition-[width] duration-1000 ease-linear ${done ? 'bg-state-posted' : 'bg-state-now/70'}`}
                style={{ width: `${total > 0 ? ((total - left) / total) * 100 : 100}%` }}
              />
            </span>
          </div>
        )
      })}
    </div>
  )
}
