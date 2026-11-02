import { useCallback, useEffect, useState } from 'react'

import { CopyIcon, PlusIcon } from '../components/icons'
import { Button, Disclosure, StateDot } from '../components/ui'
import { INPUT_CLASS } from '../components/styles'
import { useAuth } from '../sync'
import { createInvite, inviteUrl, isOpen, listInvites, switchOffInvite, type InviteLink } from '../sync/invites'

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'ok'; message: string } | { kind: 'error'; message: string }

/** Ten: the class he made this for. */
const DEFAULT_MAX_USES = 10

/** Invite links, his alone. The server answers anyone else with nothing, and
 *  then this renders nothing - a student's SETUP has no such section.
 *
 *  One link per group, capped at a number of accounts. Who came in through a
 *  link is listed under it, so a link that got forwarded shows up as names he
 *  does not know, and he can switch it off. Switching off stops new accounts
 *  only: anyone already in keeps theirs. */
export function InviteLinks() {
  const auth = useAuth()
  const [links, setLinks] = useState<InviteLink[] | null | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!auth.email) return
    let cancelled = false
    void listInvites()
      .then((found) => {
        if (!cancelled) setLinks(found)
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message)
      })
    return () => {
      cancelled = true
    }
  }, [auth.email])

  const replace = useCallback((link: InviteLink) => {
    setLinks((current) => (current ?? []).map((existing) => (existing.id === link.id ? link : existing)))
  }, [])

  if (!auth.email) return null
  // Offline, or the function unreachable: say so rather than vanish, since
  // only the owner can be told apart from a student by the answer itself.
  if (loadError !== null && links === undefined) {
    return (
      <Disclosure summary="Invite links" trailing="not loaded">
        <p className="pb-4 text-base text-state-blocked">{loadError}</p>
      </Disclosure>
    )
  }
  if (!links) return null

  const open = links.filter(isOpen).length

  return (
    <Disclosure summary="Invite links" trailing={open === 0 ? 'none open' : `${open} open`}>
      <div className="flex flex-col gap-6 pb-4">
        <p className="text-base text-text-dim">
          The only way to make a new account. Anyone with a link can join until it is full or you switch it off.
          Each person gets their own empty planner and never sees yours.
        </p>
        <NewLink onMade={(link) => setLinks((current) => [link, ...(current ?? [])])} />
        {links.map((link) => (
          <LinkRow key={link.id} link={link} onChanged={replace} />
        ))}
      </div>
    </Disclosure>
  )
}

function NewLink({ onMade }: { onMade: (link: InviteLink) => void }) {
  const [count, setCount] = useState(String(DEFAULT_MAX_USES))
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const maxUses = /^\d+$/.test(count.trim()) ? Number(count.trim()) : 0

  const make = useCallback(async () => {
    setStatus({ kind: 'busy' })
    try {
      onMade(await createInvite(maxUses))
      setStatus({ kind: 'idle' })
    } catch (error) {
      setStatus({ kind: 'error', message: (error as Error).message })
    }
  }, [maxUses, onMade])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          inputMode="numeric"
          aria-label="How many people the link lets in"
          value={count}
          onChange={(event) => setCount(event.target.value)}
          disabled={status.kind === 'busy'}
          className={`${INPUT_CLASS} w-20 text-center tabular-nums`}
        />
        <span className="text-base text-text-dim">people</span>
        <Button onClick={() => void make()} disabled={maxUses < 1 || status.kind === 'busy'} className="ml-auto">
          <PlusIcon className="h-4 w-4" />
          {status.kind === 'busy' ? 'Making...' : 'New link'}
        </Button>
      </div>
      {status.kind === 'error' ? <p className="text-base text-state-blocked">{status.message}</p> : null}
    </div>
  )
}

function LinkRow({ link, onChanged }: { link: InviteLink; onChanged: (link: InviteLink) => void }) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const url = inviteUrl(link.code)
  const off = link.switched_off_at !== null
  const full = link.joined.length >= link.max_uses

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url)
      setStatus({ kind: 'ok', message: 'Copied.' })
    } catch {
      setStatus({ kind: 'error', message: 'Could not copy. Select the link and copy it by hand.' })
    }
  }, [url])

  const switchOff = useCallback(async () => {
    setStatus({ kind: 'busy' })
    try {
      onChanged(await switchOffInvite(link.id))
      setStatus({ kind: 'idle' })
    } catch (error) {
      setStatus({ kind: 'error', message: (error as Error).message })
    }
  }, [link.id, onChanged])

  return (
    <div className="flex flex-col gap-2 border-t border-rule pt-4">
      <div className="flex items-center gap-3">
        <StateDot tone={off || full ? 'later' : 'now'} />
        <span className="tabular-nums text-base text-text">
          {link.joined.length} of {link.max_uses} joined
        </span>
        <span className="meta text-state-later">{off ? 'switched off' : full ? 'full' : 'open'}</span>
      </div>

      {off ? null : (
        <>
          <p className="select-all break-all font-mono text-sm text-text-dim">{url}</p>
          <div className="flex gap-2">
            <Button onClick={() => void copy()}>
              <CopyIcon className="h-4 w-4" />
              Copy
            </Button>
            <Button variant="blocked" onClick={() => void switchOff()} disabled={status.kind === 'busy'}>
              Switch off
            </Button>
          </div>
        </>
      )}

      {link.joined.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {link.joined.map((person) => (
            <li key={`${person.email}-${person.joined_at}`} className="text-base text-text-dim">
              {person.email ?? 'no email'}
            </li>
          ))}
        </ul>
      ) : null}

      {status.kind === 'ok' ? <p className="text-base text-state-posted">{status.message}</p> : null}
      {status.kind === 'error' ? <p className="text-base text-state-blocked">{status.message}</p> : null}
    </div>
  )
}
