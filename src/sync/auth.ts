// Auth, and the client the sync target needs.
//
// The project is live and createClient/getAuthState are exercised for real by
// the live sync tests (see docs/SYNC.md), but through their own client
// instances signed up with a password - signInWithOtp itself, the magic-link
// path this app actually uses, has not yet been driven against a real inbox.
// The shape is still what matters most here: everything that needs
// credentials is behind one function, so the point where the app becomes
// online is a single place rather than scattered through the screens.

import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'

/** Read from the environment at build time.
 *
 *  The publishable key is safe in the browser - it is the anon key, and RLS is
 *  what actually protects the data. The service role key must never appear
 *  here, and neither must the model API key: that is the entire reason the
 *  parser runs in an Edge Function. */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
  | string
  | undefined

let cached: SupabaseClient | null | undefined

/** The client, or null when the project has not been configured.
 *
 *  Null is a normal state, not an error: the app is local-first and works
 *  completely without a server. Sync is the part that waits. */
export function getSupabaseClient(): SupabaseClient | null {
  if (cached !== undefined) return cached

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    cached = null
    return cached
  }

  cached = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      // He uses a PC, a MacBook and a phone, and should not be signing in on
      // each of them every week.
      persistSession: true,
      autoRefreshToken: true,
    },
  })
  return cached
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseClient() !== null
}

export interface AuthState {
  session: Session | null
  userId: string | null
}

export async function getAuthState(): Promise<AuthState> {
  const client = getSupabaseClient()
  if (!client) return { session: null, userId: null }

  const { data } = await client.auth.getSession()
  return { session: data.session, userId: data.session?.user.id ?? null }
}

/** Magic-link sign-in: no password to remember, and nothing to type on a phone
 *  beyond an email address. */
export async function signIn(email: string): Promise<void> {
  const client = getSupabaseClient()
  if (!client) throw new Error('Supabase is not configured yet.')

  const { error } = await client.auth.signInWithOtp({ email })
  if (error) throw new Error(error.message)
}

export async function signOut(): Promise<void> {
  const client = getSupabaseClient()
  if (!client) return
  await client.auth.signOut()
}

/** Local rows are minted with a local user id, because there is no auth.uid()
 *  to use before sign-in. When an account first appears, those rows have to be
 *  claimed - every user_id rewritten once - or RLS will refuse every one of
 *  them and the first sync will silently push nothing.
 *
 *  Not implemented: doing it needs a real account to test against, and getting
 *  it wrong means orphaning the only copy of his data. See docs/SYNC.md. */
export const LOCAL_ROWS_NEED_CLAIMING = true
