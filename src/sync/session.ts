// When a sign-in has stopped working.

/** Whether a session's token ran out more than a minute ago - which, with
 *  supabase-js renewing it ahead of time, means renewing it failed. */
export function sessionExpired(expiresAt: number | undefined, now: number): boolean {
  return expiresAt !== undefined && expiresAt * 1000 < now - 60_000
}
