import { useContext } from 'react'

import { SessionContext, type SessionControls } from './SessionContext'

export function useSession(): SessionControls {
  const controls = useContext(SessionContext)
  if (!controls) throw new Error('useSession must be used inside a SessionProvider')
  return controls
}
