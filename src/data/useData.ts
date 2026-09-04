import { useContext } from 'react'

import { DataContext } from './context'
import type { DataAdapter } from './DataAdapter'

/** The only way a component reaches persistence. */
export function useData(): DataAdapter {
  const adapter = useContext(DataContext)
  if (!adapter) throw new Error('useData must be used inside a DataProvider')
  return adapter
}
