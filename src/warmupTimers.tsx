// Every running warm-up timer, kept above the routes.
//
// The timer used to live inside the Now screen, so tapping over to Post to
// check a setup threw it away: "if I leave the page for 2 seconds ... I don't
// want to come back to the Now page and have the timer reset." The provider
// sits in the app shell, which never unmounts while he moves between tabs, and
// the widget it renders is pinned to the top of every screen.
//
// State is timestamps in localStorage (see warmupTimer.ts), so a timer also
// survives a reload and is right after the phone was put down for ten minutes.

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

import { warmupMinutesFor, type CampaignAccount } from './data'
import { useData } from './data/useData'
import { playWarmupDone, unlockAudio } from './sound'
import {
  formatClock,
  isFinished,
  readTimers,
  secondsLeft,
  startTimer,
  writeTimers,
  type WarmupTimerRecord,
} from './warmupTimer'

interface WarmupTimersValue {
  timers: WarmupTimerRecord[]
  /** The clock every timer is measured against; ticks once a second while any
   *  timer exists. */
  now: number
  /** Starts a timer for this account, or leaves one already running alone.
   *  `minutes` overrides the account's own default length - see
   *  warmupMinutesFor - for the one time he picks something else. */
  start: (account: CampaignAccount, campaignName: string, minutes?: number) => void
  /** Stops a timer without recording anything. */
  cancel: (accountId: string) => void
  /** Records the session against the account and removes its timer. */
  complete: (accountId: string) => Promise<void>
  /** Bumps each time a session is recorded, so a screen showing warm-up
   *  history knows to reload it. */
  completions: number
  /** The account whose full-size timer is on screen, if any - the widget
   *  hides that one rather than showing it twice. */
  setViewing: (accountId: string | null) => void
}

const Context = createContext<WarmupTimersValue | null>(null)

export function useWarmupTimers(): WarmupTimersValue {
  const value = useContext(Context)
  if (value === null) throw new Error('useWarmupTimers must be used inside WarmupTimersProvider')
  return value
}

export function WarmupTimersProvider({ children }: { children: ReactNode }) {
  const data = useData()
  const [timers, setTimers] = useState<WarmupTimerRecord[]>(readTimers)
  const [now, setNow] = useState(() => Date.now())
  const [completions, setCompletions] = useState(0)
  const [viewing, setViewingState] = useState<string | null>(null)

  // Written on every change, so what is stored is always what is running.
  useEffect(() => {
    writeTimers(timers)
  }, [timers])

  // One clock for all of them, and only while there is something to count.
  useEffect(() => {
    if (timers.length === 0) return
    setNow(Date.now())
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

  // A wake-up at the exact moment each timer ends. A background tab throttles
  // its once-a-second tick, and after a few minutes hidden a browser may run
  // it only about once a minute - so on its own the chime could sound up to a
  // minute late. One timeout set for the end time is not part of that chain.
  useEffect(() => {
    const waits = timers
      .filter((t) => !t.alerted)
      .map((t) =>
        window.setTimeout(() => setNow(Date.now()), Math.max(0, t.endsAt - Date.now()) + 50),
      )
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
      ? `Time's up - ${next.platform} warm-up`
      : `${formatClock(secondsLeft(next, now))} ${next.platform} warm-up`
  }, [timers, now])

  // The chime, once per timer. The ref is what guarantees "once": state can
  // lag a render behind, and two ticks in that gap must not ring it twice.
  const chimed = useRef(new Set<string>())
  useEffect(() => {
    const due = timers.filter(
      (t) => !t.alerted && isFinished(t, now) && !chimed.current.has(`${t.accountId}:${t.startedAt}`),
    )
    if (due.length === 0) return

    for (const t of due) chimed.current.add(`${t.accountId}:${t.startedAt}`)
    playWarmupDone()
    try {
      navigator.vibrate?.([200, 100, 200])
    } catch {
      /* not every device has a motor */
    }
    setTimers((current) =>
      current.map((t) =>
        due.some((d) => d.accountId === t.accountId && d.startedAt === t.startedAt)
          ? { ...t, alerted: true }
          : t,
      ),
    )
  }, [timers, now])

  const start = useCallback((account: CampaignAccount, campaignName: string, minutes?: number) => {
    // In the tap that starts it, so the chime is allowed to sound later.
    unlockAudio()
    setTimers((current) => {
      if (current.some((t) => t.accountId === account.id)) return current
      return [
        ...current,
        startTimer(
          {
            accountId: account.id,
            platform: account.platform,
            handle: account.handle,
            campaignName,
            minutes: minutes ?? warmupMinutesFor(account),
          },
          Date.now(),
        ),
      ]
    })
    setNow(Date.now())
  }, [])

  const cancel = useCallback((accountId: string) => {
    setTimers((current) => current.filter((t) => t.accountId !== accountId))
  }, [])

  const complete = useCallback(
    async (accountId: string) => {
      const timer = timers.find((t) => t.accountId === accountId)
      if (!timer) return
      await data.recordWarmupEvent(accountId, timer.minutes)
      setTimers((current) => current.filter((t) => t.accountId !== accountId))
      setCompletions((count) => count + 1)
    },
    [data, timers],
  )

  const value = useMemo<WarmupTimersValue>(
    () => ({ timers, now, start, cancel, complete, completions, setViewing: setViewingState }),
    [timers, now, start, cancel, complete, completions],
  )

  return (
    <Context.Provider value={value}>
      <WarmupBar viewing={viewing} />
      {children}
    </Context.Provider>
  )
}

/** The strip pinned to the top of every screen while a timer runs.
 *
 *  Green is the one state colour it borrows, and only once the time is up:
 *  running is plain, done is done. Tapping the row goes back to the full
 *  timer; when it has finished the row carries the one-tap "Mark warmed". */
function WarmupBar({ viewing }: { viewing: string | null }) {
  const { timers, now, complete, cancel } = useWarmupTimers()
  const navigate = useNavigate()
  const [busy, setBusy] = useState<string | null>(null)

  const shown = timers
    .filter((t) => t.accountId !== viewing)
    .sort((a, b) => a.endsAt - b.endsAt)

  if (shown.length === 0) return null

  return (
    <div
      className="sticky top-0 z-40 flex flex-col gap-1.5 border-b border-edge bg-surface/90 px-3 pb-2 backdrop-blur-xl"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
      role="region"
      aria-label="Warm-up timers"
    >
      {shown.map((timer) => {
        const done = isFinished(timer, now)
        return (
          <div
            key={timer.accountId}
            className={[
              'flex items-center gap-3 rounded-xl border px-3 py-2',
              done ? 'border-state-posted/50 bg-state-posted/10' : 'border-edge bg-surface-raised',
            ].join(' ')}
          >
            <button
              type="button"
              onClick={() => navigate('/', { state: { openTimer: timer.accountId } })}
              className="flex min-h-tap min-w-0 flex-1 items-center justify-between gap-3 text-left"
              aria-label={`Open the ${timer.platform} warm-up timer`}
            >
              <span className="min-w-0">
                <span className="block truncate text-base font-semibold text-text">
                  {timer.platform}
                  <span className="ml-2 font-normal text-state-later">
                    {timer.handle ?? timer.campaignName}
                  </span>
                </span>
                <span className="meta block text-state-later">
                  {done ? "Time's up - warm-up done" : 'Warm-up running'}
                </span>
              </span>
              <span
                className={`numeric shrink-0 text-2xl font-semibold ${done ? 'text-state-posted' : 'text-text'}`}
                aria-live="off"
              >
                {formatClock(secondsLeft(timer, now))}
              </span>
            </button>
            {done ? (
              <button
                type="button"
                disabled={busy === timer.accountId}
                onClick={() => {
                  setBusy(timer.accountId)
                  void complete(timer.accountId).finally(() => setBusy(null))
                }}
                className="min-h-tap shrink-0 rounded-lg border border-state-posted/60 bg-surface px-3 text-base font-semibold text-state-posted active:bg-surface-raised disabled:opacity-60"
              >
                Mark warmed
              </button>
            ) : (
              <button
                type="button"
                onClick={() => cancel(timer.accountId)}
                aria-label={`Cancel the ${timer.platform} timer`}
                className="min-h-tap shrink-0 rounded-lg px-2 text-base text-state-later active:bg-surface"
              >
                Cancel
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
