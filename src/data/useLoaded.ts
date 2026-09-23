// Reading rows into a screen, and reading them again after a write.
//
// Every screen used to do this by hand - a load function, an effect to call it
// on mount, and the same function called again after each write - and each
// did it slightly differently: some guarded against the screen having gone
// away, most did not, and none guarded against an older read landing after a
// newer one. On the Post screen that is two quick taps: two reloads in
// flight, and if the first resolved last it put the screen back one tap.
// Here, only the latest read ever reaches the screen.

import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'

/** Runs `load` on mount and whenever `deps` change, and hands back its
 *  result (null until the first read lands) and a `reload` to call after a
 *  write. A read that has been overtaken by a newer one, or that finishes
 *  after the screen is gone, is dropped. */
export function useLoaded<T>(
  load: () => Promise<T>,
  deps: DependencyList,
): [value: T | null, reload: () => Promise<void>] {
  const [value, setValue] = useState<T | null>(null)
  const latest = useRef(0)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps)

  const reload = useCallback(async () => {
    const mine = ++latest.current
    const next = await run()
    if (mine === latest.current) setValue(() => next)
  }, [run])

  useEffect(() => {
    // The counter itself, not a DOM node: bumping it on cleanup is what
    // makes any read still in flight land nowhere.
    const counter = latest
    void reload()
    return () => {
      // Anything still in flight belongs to a screen that is gone.
      counter.current++
    }
  }, [reload])

  return [value, reload]
}
