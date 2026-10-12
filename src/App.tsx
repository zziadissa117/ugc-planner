import { useContext, useEffect, useState, type ComponentType } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { BriefsIcon, MoneyIcon, NowIcon, PostIcon, SetupIcon } from './components/icons'
import { useData } from './data/useData'
import { Button } from './components/ui'
import { AuthContext } from './sync/AuthContext'
import { useCutterBridge } from './sync/cutterBridge'
import { WarmupTimersProvider } from './warmupTimers'

/** Five tabs, and nothing behind any of them that has to be planned first.
 *
 *  POST is permanent: what is owed today is the one thing he checks without
 *  having decided to work first, and it is the daily habit the rest of the
 *  app feeds. */
const TABS: { to: string; label: string; end: boolean; Icon: ComponentType<{ className?: string }> }[] = [
  { to: '/', label: 'NOW', end: true, Icon: NowIcon },
  { to: '/post', label: 'POST', end: false, Icon: PostIcon },
  { to: '/campaigns', label: 'BRIEFS', end: false, Icon: BriefsIcon },
  { to: '/money', label: 'MONEY', end: false, Icon: MoneyIcon },
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

  // Read directly rather than through useAuth: the shell also renders in
  // tests with no sign-in at all, and then there is nothing to warn about.
  const auth = useContext(AuthContext)
  const sessionLost = auth?.sessionLost ?? false

  // While the sign-in is dead every call would be refused; wait for him.
  useCutterBridge(data, ready && !sessionLost)

  return (
    <div className="flex min-h-dvh flex-col text-text">
      {/* Above the routes, so a running warm-up timer outlives every screen
          change. It renders its own strip at the top of the page. */}
      <WarmupTimersProvider>
        {sessionLost && auth ? <SignedOut email={auth.email} onSignIn={auth.signOut} /> : null}
        <main key={ready ? `ready:${section}` : 'loading'} className="rise-in flex-1 px-4 pb-6 pt-5">
          {ready ? <Outlet /> : null}
        </main>

        {/* Black glass with a hairline edge, so the page visibly carries on
            underneath rather than the bar reading as the end of the screen. */}
        <nav
          className="sticky bottom-0 z-30 border-t border-rule bg-ink/85 backdrop-blur-xl"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <ul className="mx-auto flex max-w-screen-sm">
            {TABS.map(({ to, label, end, Icon }) => (
              <li key={to} className="flex-1">
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    [
                      // Full-width, full-height target: the whole fifth of the
                      // bar is tappable, not just the word.
                      'press relative flex min-h-tap flex-col items-center justify-center gap-1 pb-1 pt-2',
                      'transition-colors duration-200',
                      // Where you are is a state, so it gets the "now" colour.
                      // Everything else is a "later" grey.
                      isActive ? 'text-state-now' : 'text-state-later',
                    ].join(' ')
                  }
                >
                  {({ isActive }) => (
                    <>
                      {/* The lit rule sits on the bar's own top edge, so the
                          active tab looks connected to the screen above it. */}
                      {isActive ? (
                        <span
                          aria-hidden
                          className="settle-in absolute inset-x-5 -top-px h-px bg-state-now shadow-[0_0_12px_1px_var(--color-state-now)]"
                        />
                      ) : null}
                      <Icon className="h-[22px] w-[22px]" />
                      <span
                        className={`text-[0.8125rem] font-semibold leading-none ${
                          isActive ? 'tracking-[0.12em]' : 'tracking-[0.08em]'
                        }`}
                      >
                        {label}
                      </span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
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
