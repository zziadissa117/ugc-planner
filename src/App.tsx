import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'

import { ensureSeeded } from './data/seed'
import { useData } from './data/useData'

/** The tabs worth a permanent slot. SHOOT and the tick-off list are reached
 *  from NOW, because both only make sense once he has said what he is doing.
 *
 *  POST is permanent even though it is a kind of session: what is owed today
 *  is the one thing he checks without having decided to work first, and it is
 *  the daily habit the rest of the app feeds. */
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
    <div className="flex min-h-dvh flex-col bg-ink text-text">
      <main className="flex-1 px-4 pt-6 pb-4">{ready ? <Outlet /> : null}</main>

      <nav
        className="sticky bottom-0 border-t border-edge bg-surface"
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
                    // Full-width, full-height target: the whole quarter of the
                    // bar is tappable, not just the word.
                    'flex min-h-tap items-center justify-center text-sm font-semibold tracking-wide',
                    'transition-none active:bg-surface-raised',
                    // Where you are is a state, so it gets the "now" colour.
                    // Everything else is a "later" grey.
                    isActive ? 'text-state-now' : 'text-state-later',
                  ].join(' ')
                }
              >
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
