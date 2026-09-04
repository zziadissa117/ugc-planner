import { useCallback, useMemo, useState, type ReactNode } from 'react'

import { SessionContext, type ActiveSession } from './SessionContext'

/** Holds the evening in progress so NOW and SHOOT are looking at the same one.
 *
 *  Deliberately in memory only. A session is a decision about the next ninety
 *  minutes, not a record of anything - everything it produces (phase moves,
 *  new supply rows) is already written to the store the moment it happens, so
 *  there is nothing here worth persisting. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveSession | null>(null)

  const start = useCallback((session: Omit<ActiveSession, 'index'>) => {
    setActive({ ...session, index: 0 })
  }, [])

  const goTo = useCallback((index: number) => {
    setActive((current) => (current ? { ...current, index } : current))
  }, [])

  const skip = useCallback(() => {
    setActive((current) => {
      if (!current) return current
      // Wraps, so skipping the last one comes back round rather than dropping
      // him out of the session with work still on the list.
      const next = current.videoIds.length === 0 ? 0 : (current.index + 1) % current.videoIds.length
      return { ...current, index: next }
    })
  }, [])

  const stop = useCallback(() => setActive(null), [])

  const value = useMemo(
    () => ({ active, start, goTo, skip, stop }),
    [active, goTo, skip, start, stop],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}
