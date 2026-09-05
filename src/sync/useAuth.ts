import { useContext } from 'react'

import { AuthContext, type AuthControls } from './AuthContext'

export function useAuth(): AuthControls {
  const controls = useContext(AuthContext)
  if (!controls) throw new Error('useAuth must be used inside an AuthProvider')
  return controls
}
