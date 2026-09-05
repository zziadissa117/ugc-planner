import { createContext } from 'react'

export interface AuthControls {
  /** False when the project is not configured at all - VITE_SUPABASE_URL /
   *  VITE_SUPABASE_PUBLISHABLE_KEY are absent. The app works completely
   *  without this ever being true; it only gates the AI parser and sync. */
  configured: boolean
  /** The signed-in account's email, or null while signed out. */
  email: string | null
  requestStatus: 'idle' | 'sending' | 'sent' | 'error'
  requestError: string | null
  /** Magic-link sign-in: nothing to type but an email address. */
  requestLink: (email: string) => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthControls | null>(null)
