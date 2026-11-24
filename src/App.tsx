import { useContext, useEffect, useState, type ComponentType } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { BriefsIcon, IdeateIcon, NowIcon, PostIcon, SetupIcon } from './components/icons'
import { isDataFailure, plainError } from './data/errorText'
import { useData } from './data/useData'
import { useLoaded } from './data/useLoaded'
import { Button } from './components/ui'
import { AuthContext } from './sync/AuthContext'
import { WarmupTimersProvider } from './warmupTimers'

/** Five tabs, the student's week in order: what today holds, the posts it
 *  owes, the campaigns behind them, what to improve, and setup. Money is no
 *  longer a tab - its summary sits at the bottom of CAMPAIGNS. */
const TABS: { to: string; label: string; end: boolean; Icon: ComponentType<{ className?: string }> }[] = [
  { to: '/', label: 'TODAY', end: true, Icon: NowIcon },
  { to: '/post', label: 'POST', end: false, Icon: PostIcon },
  { to: '/campaigns', label: 'CAMPAIGNS', end: false, Icon: BriefsIcon },
  { to: '/ideate', label: 'IDEATE', end: false, Icon: IdeateIcon },
  { to: '/settings', label: 'SETUP', end: false, Icon: SetupIcon },
]

export function App() {
  const data = useData()
  const [ready, setReady] = useState(false)
  // Each tab arrives on the settle spring rather than snapping in - keyed on
  // the first path segment, so moving between a brief and its update screen
  // counts as staying put.
  const section = useLocation().pathname.split('/')[1] ?? ''

  // Nothing is seeded any more. The app used to create the Inflow campaign -
  // its rate, rules and contract terms - for every new user on first launch,
  // which handed one person's private deal to everyone the planner was shared
  // with, and shipped it in the public bundle. A new account starts empty; the
  // owner's own campaign arrives from his account on sign-in.
  useEffect(() => {
    let cancelled = false
    void Promise.resolve()
      .then(async () => {
        // Ticks made before the earnings history existed get their rows. Safe
        // on every launch and on every device: it writes nothing that is
        // already there. A failure here costs a history entry, never the app.
        try {
          await data.backfillEarningsHistory()
        } catch {
          /* the history catches up on the next launch */
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [data])

  // Everyone answers the onboarding quiz and places their week once - every
  // student, and him. Until a week is saved, the planner sends them there.
  // Setup stays open so a student can sign in first (and a signed-in week
  // arrives by sync instead of being asked for again), and so does the join
  // link. Checked by reading only: nothing is written until he saves.
  const location = useLocation()
  const go = useNavigate()
  const [planned] = useLoaded(async () => (await data.listPlanBlocks()).length > 0, [data])
  useEffect(() => {
    if (planned !== false) return
    const path = location.pathname
    if (path === '/start' || path.startsWith('/join') || path.startsWith('/settings')) return
    void go('/start', { replace: true })
  }, [planned, location.pathname, go])

  // Read directly rather than through useAuth: the shell also renders in
  // tests with no sign-in at all, and then there is nothing to warn about.
  const auth = useContext(AuthContext)
  const sessionLost = auth?.sessionLost ?? false

  // A save that fails where nothing was listening - a switch tapped, a
  // payout date picked, a login box left - used to do nothing at all: the
  // promise rejected unwatched and the control sat there as if the tap had
  // not happened. The store's own refusals are caught here and said once,
  // in words; the network's failures are not, because sync retries those by
  // itself and a red line every thirty seconds offline would be noise.
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      if (!isDataFailure(event.reason)) return
      event.preventDefault()
      setFailed(plainError(event.reason))
    }
    window.addEventListener('unhandledrejection', onRejection)
    return () => window.removeEventListener('unhandledrejection', onRejection)
  }, [])
  useEffect(() => {
    if (failed === null) return
    const timer = window.setTimeout(() => setFailed(null), 10_000)
    return () => window.clearTimeout(timer)
  }, [failed])

  return (
    <div className="relative isolate flex min-h-dvh flex-col text-text">
      {/* The deck's glow behind every screen, and its faint dot grid fading
          out from it - the quiz's ground, carried into the planner. */}
      {section === 'start' ? null : (
        <>
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[70vh] bg-[url('/roadmap/bg-logo.jpeg')] bg-cover bg-top opacity-90 [mask-image:linear-gradient(to_bottom,black_40%,transparent)]" />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[70vh]"
            style={{
              backgroundImage: 'radial-gradient(rgba(134,168,255,0.14) 1px, transparent 1px)',
              backgroundSize: '22px 22px',
              maskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, black 0%, transparent 75%)',
              WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, black 0%, transparent 75%)',
            }}
          />
        </>
      )}
      {/* Above the routes, so a running warm-up timer outlives every screen
          change. It renders its own strip at the top of the page. */}
      <WarmupTimersProvider>
        {sessionLost && auth ? <SignedOut email={auth.email} onSignIn={auth.signOut} /> : null}
        {failed ? (
          <div role="alert" className="border-b border-state-blocked/60 px-4 py-3">
            <div className="mx-auto flex max-w-4xl items-start gap-4">
              <p className="min-w-0 flex-1 text-base text-state-blocked">That didn't save: {failed}</p>
              <Button variant="ghost" size="small" onClick={() => setFailed(null)}>
                OK
              </Button>
            </div>
          </div>
        ) : null}
        {section === 'start' ? null : (
          <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 pt-5">
            <img src="/roadmap/logo-cover.png" alt="UGC Roadmap" className="h-8 w-auto" />
          </header>
        )}
        <main key={ready ? `ready:${section}` : 'loading'} className="rise-in flex-1 px-4 pb-8 pt-6">
          {ready ? <Outlet /> : null}
        </main>

        {/* Dark glass with a hairline edge, so the page visibly carries on
            underneath. Not on the onboarding quiz: it is a full-screen page
            of its own, and the tabs behind it are not his to use until it is
            done. The tab you are on is lit in the deck's blue. */}
        {section === 'start' ? null : (
          <nav
            className="sticky bottom-0 z-30 border-t border-edge/70 bg-ink/80 backdrop-blur-xl"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            <ul className="mx-auto flex max-w-screen-md">
              {TABS.map(({ to, label, end, Icon }) => (
                <li key={to} className="min-w-0 flex-1">
                  <NavLink
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      [
                        // Full-width, full-height target: the whole fifth of
                        // the bar is tappable, not just the word.
                        'press relative flex min-h-tap flex-col items-center justify-center gap-1 pb-1 pt-2',
                        'transition-colors duration-200',
                        isActive ? 'text-brand' : 'text-state-later hover:text-text-dim',
                      ].join(' ')
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive ? (
                          <span
                            aria-hidden
                            className="settle-in absolute inset-x-4 -top-px h-[2px] rounded-full bg-[linear-gradient(90deg,#6585F5,#86A8FF)] shadow-[0_0_14px_1px_rgba(101,133,245,0.8)]"
                          />
                        ) : null}
                        <Icon className="h-[22px] w-[22px]" />
                        <span className="max-w-full truncate px-0.5 text-[0.625rem] font-bold leading-none tracking-[0.06em] min-[400px]:text-[0.6875rem] sm:text-[0.75rem] sm:tracking-[0.12em]">
                          {label}
                        </span>
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </WarmupTimersProvider>
    </div>
  )
}

/** The sign-in stopped working while the app still looked signed in - the
 *  server refused to renew it. Everything on this device is kept; nothing
 *  goes up, and the cutter cannot tick posts, until he signs in again. Red:
 *  blocked, with the reason in plain words. */
export function SignedOut({ email, onSignIn }: { email: string | null; onSignIn: () => Promise<void> }) {
  const navigate = useNavigate()
  return (
    <div role="alert" className="border-b border-state-blocked/60 px-4 py-3">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1 text-base text-state-blocked">
          Signed out{email ? ` (${email})` : ''} - nothing is syncing and the cutter can't tick posts. Your work on
          this computer is kept.
        </p>
        <Button
          variant="blocked"
          size="small"
          onClick={() => {
            void onSignIn().finally(() => navigate('/settings'))
          }}
        >
          Sign in again
        </Button>
      </div>
    </div>
  )
}
