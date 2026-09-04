import { createContext } from 'react'

import type { DataAdapter } from './DataAdapter'

/** Split out from DataProvider so that file exports only a component and Fast
 *  Refresh keeps working. */
export const DataContext = createContext<DataAdapter | null>(null)
