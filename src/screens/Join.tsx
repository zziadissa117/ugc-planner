import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { BackIcon } from '../components/icons'
import { Button, ScreenHeader } from '../components/ui'
import { INPUT_CLASS, buttonClass } from '../components/styles'
import { INVITE_REFUSALS, inviteStatus, useAuth, type InviteStatus } from '../sync'

/** Where an invite link lands: /join/<code>.
 *
 *  The only place an account can be made. The sign-in box in SETUP signs in
 *  accounts that exist; this one sends the invite code along, and the server
 *  decides (docs/migrations/0021_invite_links.sql) - a switched-off or full
 *  link is refused there. The link is asked first whether it is still open, so
 *  a dead one says so before anyone types an email; when the server cannot be
 *  asked, the box is shown anyway and the server still decides. An address
 *  that already has an account just gets signed in. */
export function Join() {
  const { code = '' } = useParams()
  const auth = useAuth()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<InviteStatus | null>(null)

  useEffect(() => {
    if (!auth.configured || auth.email) return
    let cancelled = false
    void inviteStatus(code)
      .then((found) => {
        if (!cancelled) setStatus(found)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [auth.configured, auth.email, code])

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

  const busy = auth.requestStatus === 'sending' || auth.requestStatus === 'sent'

  return (
    <section className="mx-auto flex max-w-screen-sm flex-col gap-6">
      <ScreenHeader title="Join the planner" />
      <p className="text-base text-text-dim">
        Enter your email. You will get a link that creates your account and signs you in.
      </p>
      <div className="flex gap-2">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          aria-label="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          disabled={busy}
          className={`${INPUT_CLASS} min-w-0 flex-1 disabled:text-state-later`}
        />
        <Button onClick={() => void auth.requestLink(email.trim(), code)} disabled={email.trim() === '' || busy}>
          {auth.requestStatus === 'sending' ? 'Sending...' : 'Send link'}
        </Button>
      </div>
      {auth.requestStatus === 'sent' ? (
        <p className="text-base text-state-posted">Check your email for the link.</p>
      ) : null}
      {auth.requestStatus === 'error' ? <p className="text-base text-state-blocked">{auth.requestError}</p> : null}
    </section>
  )
}
