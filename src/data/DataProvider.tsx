// Hands the adapter to the tree. One instance for the life of the app, so
// every screen writes through the same store and the same outbox.

import { useMemo, type ReactNode } from 'react'

import { DataContext } from './context'
import type { DataAdapter } from './DataAdapter'
import { createAdapter } from './index'

export function DataProvider({
  children,
  adapter,
}: {
  children: ReactNode
  /** Injectable so a test can supply an adapter over its own database. */
  adapter?: DataAdapter
}) {
  const value = useMemo(() => adapter ?? createAdapter(), [adapter])
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}
