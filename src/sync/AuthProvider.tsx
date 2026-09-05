// Wires the auth state that already existed (src/sync/auth.ts, claim.ts) into
// the running app. Both were built and tested against a real project, but
// nothing ever called them from a screen - there was no sign-in UI anywhere,
// so an account could never actually exist from the app's point of view, and
// the parser Edge Function (which requires a session) was unreachable no
// matter how it was deployed.
//
// Mounted once at the app root (see main.tsx) so the magic-link redirect is
// caught regardless of which screen it lands on - it will not necessarily be
// the one the sign-in form was on, since the link is opened from an email,
// often on a different tab or device.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { useData } from '../data/useData'
import { AuthContext, type AuthControls } from './AuthContext'
import { claimLocalRows } from './claim'
import { getSupabaseClient, signIn, signOut as signOutRemote } from './auth'

export function AuthProvider({ children }: { children: ReactNode }) {
  const data = useData()
  const client = useMemo(() => getSupabaseClient(), [])

  const [email, setEmail] = useState<string | null>(null)
  const [requestStatus, setRequestStatus] = useState<AuthControls['requestStatus']>('idle')
  const [requestError, setRequestError] = useState<string | null>(null)

  useEffect(() => {
    if (!client) return
    let cancelled = false

    void client.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) setEmail(session?.user.email ?? null)
    })

    // claimLocalRows is a no-op the second time (src/sync/claim.ts), so
    // calling it on every SIGNED_IN event rather than only "the first ever"
    // is safe and simpler than tracking whether this is a fresh sign-in.
    const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      setEmail(session?.user.email ?? null)
      const userId = session?.user.id ?? null
      if (userId) {
        void claimLocalRows(data, { getAuthState: async () => ({ userId }) })
      }
    })

    return () => {
      cancelled = true
      subscription.subscription.unsubscribe()
    }
  }, [client, data])

  const requestLink = useCallback(async (target: string) => {
    setRequestStatus('sending')
    setRequestError(null)
    try {
      await signIn(target)
      setRequestStatus('sent')
    } catch (caught) {
      setRequestStatus('error')
      setRequestError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [])

  const signOut = useCallback(async () => {
    await signOutRemote()
    setEmail(null)
    setRequestStatus('idle')
  }, [])

  const value = useMemo<AuthControls>(
    () => ({ configured: client !== null, email, requestStatus, requestError, requestLink, signOut }),
    [client, email, requestError, requestLink, requestStatus, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
