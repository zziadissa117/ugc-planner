import { useEffect, useState, type ComponentType } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'

import { BriefsIcon, MoneyIcon, NowIcon, PostIcon, SetupIcon } from './components/icons'
import { ensureSeeded } from './data/seed'
import { useData } from './data/useData'
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

  // The seed runs before anything renders, so no screen ever paints an empty
  // state that is about to fill itself in a moment later.
  useEffect(() => {
    let cancelled = false
    void ensureSeeded(data)
      .catch(() => {
        // A failed seed must not take the app down with it: everything else
        // still works, and the campaigns list will simply be empty.
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [data])

  return (
    <div className="flex min-h-dvh flex-col text-text">
      {/* Above the routes, so a running warm-up timer outlives every screen
          change. It renders its own strip at the top of the page. */}
      <WarmupTimersProvider>
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
