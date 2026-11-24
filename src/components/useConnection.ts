// Whether the device has a connection, for the screens that read something
// only the server has (IDEATE's videos, the coach view). `tick` moves every
// time the connection comes or goes, so a read keyed on it runs again when
// the connection comes back.

import { useEffect, useState } from 'react'

const onLine = () => typeof navigator === 'undefined' || navigator.onLine !== false

export function useConnection(): { online: boolean; tick: number } {
  const [state, setState] = useState(() => ({ online: onLine(), tick: 0 }))
  useEffect(() => {
    const update = () => setState((s) => ({ online: onLine(), tick: s.tick + 1 }))
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return state
}
