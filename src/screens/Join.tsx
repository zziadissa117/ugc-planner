import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { BackIcon } from '../components/icons'
import { ScreenHeader } from '../components/ui'
import { buttonClass } from '../components/styles'
import { INVITE_REFUSALS, inviteStatus, useAuth, type InviteStatus } from '../sync'
import { keepInvite } from '../sync/onboardingDraft'

/** Where an invite link lands: /join/<code>.
 *
 *  The only way in for a new account. The link is asked first whether it is
 *  still open, so a dead one says so before anyone starts; an open one - or
 *  one that cannot be checked, offline - keeps its code and opens the quiz,
 *  and the account is made at the end of it (Start's account step sends the
 *  code with the email). The server decides (docs/migrations/0021_invite_
 *  links.sql): a switched-off or full link is refused there too. An address
 *  that already has an account just gets signed in. */
export function Join() {
  const { code = '' } = useParams()
  const auth = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<InviteStatus | null>(null)

  useEffect(() => {
    if (!auth.configured || auth.email) return
    let cancelled = false
    const start = () => {
      if (cancelled) return
      keepInvite(code)
      void navigate('/start', { replace: true })
    }
    void inviteStatus(code)
      .then((found) => {
        if (cancelled) return
        if (found === 'open') start()
        else setStatus(found)
      })
      .catch(start)
    return () => {
      cancelled = true
    }
  }, [auth.configured, auth.email, code, navigate])

  if (!auth.configured) {
    return (
      <section className="mx-auto flex max-w-screen-sm flex-col gap-6">
        <ScreenHeader title="Join the planner" />
        <p className="text-base text-state-blocked">Sign-in is not set up on this copy of the planner.</p>
      </section>
    )
  }

  if (auth.email) {
    return (
      <section className="mx-auto flex max-w-screen-sm flex-col gap-6">
        <ScreenHeader title="Join the planner" />
        <p className="text-base text-text-dim">
          You are signed in as <span className="text-text">{auth.email}</span>.
        </p>
        <Link to="/" className={`${buttonClass('quiet')} self-start`}>
          <BackIcon className="h-4 w-4" />
          Go to NOW
        </Link>
      </section>
    )
  }

  if (status !== null && status !== 'open') {
    return (
      <section className="mx-auto flex max-w-screen-sm flex-col gap-6">
        <ScreenHeader title="Join the planner" />
        <p className="text-base text-state-blocked">{INVITE_REFUSALS[status]} Ask for a new one.</p>
      </section>
    )
  }

  return (
    <section className="mx-auto flex max-w-screen-sm flex-col gap-6">
      <ScreenHeader title="Join the planner" />
      <p className="text-base text-text-dim">Checking your invite...</p>
    </section>
  )
}
