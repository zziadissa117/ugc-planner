import { createContext } from 'react'

import type { SessionType } from '../data'

/** The evening in progress.
 *
 *  `videoIds` is the frozen plan order from the fitting algorithm. It is the
 *  session's spine: NOW renders it as the list, SHOOT walks it one at a time,
 *  and neither recomputes it. A tap changes what a row says, never the order,
 *  and never which video SHOOT is on. */
export interface ActiveSession {
  type: SessionType
  windowMinutes: number
  videoIds: string[]
  /** Where SHOOT is in the list. */
  index: number
}

export interface SessionControls {
  active: ActiveSession | null
  start: (session: Omit<ActiveSession, 'index'>) => void
  /** Move to a specific position - used when NOW starts SHOOT on a row. */
  goTo: (index: number) => void
  /** Leave this video where it is and move on. */
  skip: () => void
  stop: () => void
}

export const SessionContext = createContext<SessionControls | null>(null)
