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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { useData } from '../data/useData'
import { AuthContext, type AuthControls } from './AuthContext'
import { claimLocalRows } from './claim'
import { drainOutbox, pullChanges } from './engine'
import { getSupabaseClient, signIn, signOut as signOutRemote } from './auth'
import { sessionExpired } from './session'
import { SupabaseSyncTarget } from './supabaseTarget'

const SYNC_CURSOR_KEY = 'ugc-planner.sync_cursor'

/** Set once the device has queued the history it made before the outbox was
 *  carrying everything. Client-side state, like the cursor above.
 *
 *  The `_v2` is deliberate. Until migration 0011 reached the server, it refused
 *  every campaign write, and a write refused five times is left stuck in the
 *  queue for good. Changing the key makes each device queue its rows afresh
 *  once, so those edits go up now the column exists. Re-queueing is safe: rows
 *  upsert by id and the history tables deduplicate on client_id. */
const OUTBOX_BACKFILL_KEY = 'ugc-planner.outbox_backfilled_at_v2'

export function AuthProvider({ children }: { children: ReactNode }) {
  const data = useData()
  const client = useMemo(() => getSupabaseClient(), [])

  const [email, setEmail] = useState<string | null>(null)
  const [requestStatus, setRequestStatus] = useState<AuthControls['requestStatus']>('idle')
  const [requestError, setRequestError] = useState<string | null>(null)
  const [sessionLost, setSessionLost] = useState(false)
  // Set while he signs out on purpose, so that sign-out is not mistaken for
  // the server dropping him.
  const leaving = useRef(false)

  // Sync is intentionally owned by the app root: UI writes stay local-first,
  // while this small loop drains the outbox after sign-in, on reconnect, and
  // periodically while the app is open.
  useEffect(() => {
    // Lightweight auth mocks in UI tests do not expose the database client;
    // production Supabase clients always do.
    if (!client || typeof client.from !== 'function') return
    const target = new SupabaseSyncTarget(client)
    let running = false
    const run = async () => {
      if (running || !navigator.onLine) return
      const { data: { session } } = await client.auth.getSession()
      if (!session?.user.id) return
      // A dead sign-in (see the check below) would only be refused.
      if (sessionExpired(session.expires_at, Date.now())) return
      running = true
      try {
        await claimLocalRows(data, { getAuthState: async () => ({ userId: session.user.id }) })

        // Once per device: queue the rows that were written before every path
        // enqueued, and the ones a Dexie upgrade wrote straight to the store.
        // claimLocalRows above only sweeps while it is actually claiming, so
        // without this there is no path that ever carries that history up.
        if (!localStorage.getItem(OUTBOX_BACKFILL_KEY)) {
          await data.backfillOutbox()
          localStorage.setItem(OUTBOX_BACKFILL_KEY, new Date().toISOString())
        }

        await drainOutbox(data, target)
        const pulled = await pullChanges(data, target, localStorage.getItem(SYNC_CURSOR_KEY))
        if (pulled.serverTime) localStorage.setItem(SYNC_CURSOR_KEY, pulled.serverTime)
      } finally {
        running = false
      }
    }
    void run()
    const timer = window.setInterval(() => void run(), 30_000)
    window.addEventListener('online', run)
    return () => { window.clearInterval(timer); window.removeEventListener('online', run) }
  }, [client, data])

  useEffect(() => {
    if (!client) return
    let cancelled = false

    void client.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) setEmail(session?.user.email ?? null)
    })

    // supabase-js renews the token well before it runs out. One that is past
    // its time by more than a minute could not be renewed: the server refused
    // it, and every call made with it is a 401 - so say so.
    const check = () =>
      void client.auth.getSession().then(({ data: { session } }) => {
        if (!cancelled && session && sessionExpired(session.expires_at, Date.now())) setSessionLost(true)
      })
    check()
    const checking = window.setInterval(check, 30_000)

    // claimLocalRows is a no-op the second time (src/sync/claim.ts), so
    // calling it on every SIGNED_IN event rather than only "the first ever"
    // is safe and simpler than tracking whether this is a fresh sign-in.
    const { data: subscription } = client.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      // A renewal that failed signs him out from under the app; one he asked
      // for does not count. A fresh sign-in or renewal clears it.
      if (event === 'SIGNED_OUT' && !leaving.current) setSessionLost(true)
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') setSessionLost(false)
      setEmail((current) => session?.user.email ?? (event === 'SIGNED_OUT' && !leaving.current ? current : null))
      const userId = session?.user.id ?? null
      if (userId) {
        void claimLocalRows(data, { getAuthState: async () => ({ userId }) })
      }
    })

    return () => {
      cancelled = true
      window.clearInterval(checking)
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
    leaving.current = true
    try {
      await signOutRemote()
    } finally {
      leaving.current = false
    }
    setEmail(null)
    setSessionLost(false)
    setRequestStatus('idle')
  }, [])

  const value = useMemo<AuthControls>(
    () => ({ configured: client !== null, email, sessionLost, requestStatus, requestError, requestLink, signOut }),
    [client, email, requestError, requestLink, requestStatus, sessionLost, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
