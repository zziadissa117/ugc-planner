// Whether the signed-in account is his - the planner's owner, not a student
// who came in through an invite link. Asked of the `invites` function, which
// already answers that question for the invite links (only the owner gets
// `enabled: true`), so "who is the owner" stays one list on the server.
//
// The answer is kept per email on this device, so an owner-only section still
// shows offline once it has been seen online, and a student never sees it.

import { useContext, useEffect, useState } from 'react'

import { AuthContext } from './AuthContext'
import { listInvites } from './invites'

const KEY = 'ugc-planner.owner'

function remembered(email: string | null): boolean {
  if (!email) return false
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { email?: string; owner?: boolean } | null
    return saved?.email === email && saved.owner === true
  } catch {
    return false
  }
}

function remember(email: string, owner: boolean): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ email, owner }))
  } catch {
    // Storage blocked: asked again next time.
  }
}

export function useIsOwner(): boolean {
  const auth = useContext(AuthContext)
  const email = auth?.email ?? null
  const [owner, setOwner] = useState(() => remembered(email))

  useEffect(() => {
    setOwner(remembered(email))
    if (!email) return
    let cancelled = false
    listInvites()
      .then((links) => {
        const yes = links !== null
        remember(email, yes)
        if (!cancelled) setOwner(yes)
      })
      .catch(() => {
        // Offline or unreachable: keep what this device last knew.
      })
    return () => {
      cancelled = true
    }
  }, [email])

  return owner
}
