import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'

import { ensureSeeded } from './data/seed'
import { useData } from './data/useData'

/** Five tabs, and nothing behind any of them that has to be planned first.
 *
 *  POST is permanent: what is owed today is the one thing he checks without
 *  having decided to work first, and it is the daily habit the rest of the
 *  app feeds. */
const TABS = [
  { to: '/', label: 'NOW', end: true },
  { to: '/post', label: 'POST', end: false },
  { to: '/campaigns', label: 'BRIEFS', end: false },
  { to: '/money', label: 'MONEY', end: false },
  { to: '/settings', label: 'SETUP', end: false },
]

export function App() {
  const data = useData()
  const [ready, setReady] = useState(false)

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
      <main key={ready ? 'ready' : 'loading'} className="rise-in flex-1 px-3 pb-3 pt-4">
        {ready ? <Outlet /> : null}
      </main>

      {/* Glass rather than a solid slab: the screen keeps going underneath it,
          which is what stops a bottom bar reading as the end of the page. */}
      <nav
        className="sticky bottom-0 border-t border-edge bg-surface/80 backdrop-blur-xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <ul className="mx-auto flex max-w-screen-sm">
          {TABS.map((tab) => (
            <li key={tab.to} className="flex-1">
              <NavLink
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  [
                    // Full-width, full-height target: the whole fifth of the
                    // bar is tappable, not just the word.
                    'relative flex min-h-tap items-center justify-center text-sm font-semibold',
                    'transition-colors duration-150 active:bg-surface-raised',
                    // Where you are is a state, so it gets the "now" colour.
                    // Everything else is a "later" grey. The tracking opens up
                    // on the active one too, so the tab reads as lit rather
                    // than merely a slightly different grey - but not so far
                    // that five tabs stop fitting a narrow phone.
                    isActive
                      ? 'tracking-[0.12em] text-state-now'
                      : 'tracking-[0.08em] text-state-later',
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
                        className="absolute inset-x-4 -top-px h-px bg-state-now shadow-[0_0_12px_1px_var(--color-state-now)]"
                      />
                    ) : null}
                    {tab.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
