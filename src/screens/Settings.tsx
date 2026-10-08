import { useCallback, useEffect, useState } from 'react'

import { CopyIcon, UploadIcon } from '../components/icons'
import { Button, Disclosure, ScreenHeader } from '../components/ui'
import { INPUT_CLASS } from '../components/styles'
import { EXPORT_REMINDER_DAYS } from '../data'
import type { Campaign } from '../data'
import { useData } from '../data/useData'
import { useAuth } from '../sync'
import { AiKeys } from './AiKeys'
import { Priorities } from './Priorities'
type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string }


/** Export and import of all state as JSON.
 *
 *  Deliberately a textarea and a copy button rather than a file download:
 *  browsers block downloads in some contexts - an installed PWA among them -
 *  and this is the backup of record. Text he can select and paste always
 *  works. */
export function Settings() {
  const data = useData()
  const [json, setJson] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  // For the priorities list below: which line mentions which campaign, so a
  // note he writes about a campaign can jump straight to its brief.
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  useEffect(() => {
    void data.listCampaigns().then(setCampaigns)
  }, [data])
  const [exportIsStale, setExportIsStale] = useState(false)

  useEffect(() => {
    let cancelled = false
    void data.getUserSettings().then((settings) => {
      if (cancelled) return
      if (settings.last_export_at === null) return
      const ageMs = Date.now() - Date.parse(settings.last_export_at)
      setExportIsStale(ageMs > EXPORT_REMINDER_DAYS * 24 * 60 * 60 * 1000)
    })
    return () => {
      cancelled = true
    }
  }, [data])

  const handleExport = useCallback(async () => {
    setStatus({ kind: 'busy' })
    try {
      const snapshot = await data.exportAll()
      setJson(JSON.stringify(snapshot, null, 2))
      await data.updateUserSettings({ last_export_at: new Date().toISOString() })
      setExportIsStale(false)
      setStatus({ kind: 'ok', message: 'Exported. Copy it somewhere safe.' })
    } catch (error) {
      setStatus({ kind: 'error', message: describe(error) })
    }
  }, [data])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(json)
      setStatus({ kind: 'ok', message: 'Copied.' })
    } catch {
      // Clipboard access is refused in plenty of contexts. The text is already
      // on screen and selectable, so this is a nudge, not a failure.
      setStatus({ kind: 'error', message: 'Could not copy. Select the text and copy it by hand.' })
    }
  }, [json])

  const handleImport = useCallback(async () => {
    setStatus({ kind: 'busy' })
    try {
      const parsed: unknown = JSON.parse(json)
      const result = await data.importAll(parsed)
      const total = Object.values(result.counts).reduce((sum, n) => sum + n, 0)
      setStatus({ kind: 'ok', message: `Imported ${total} rows. Everything else was replaced.` })
    } catch (error) {
      setStatus({ kind: 'error', message: describe(error) })
    }
  }, [data, json])

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8">
      <ScreenHeader title="Setup" />

      {exportIsStale ? (
        <p className="border-l-2 border-state-waiting pl-3 text-base text-state-waiting">
          Your last export is more than {EXPORT_REMINDER_DAYS} days old.
        </p>
      ) : null}

      {/* The work first, and big. Everything below it is set once and folded. */}
      <Priorities campaigns={campaigns} />

      <div className="flex flex-col border-t border-rule">
        <AccountAndKeys />

        <Disclosure summary="Backup" trailing="Export / import">
          <div className="flex flex-col gap-3 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <Button onClick={() => void handleExport()}>
                <UploadIcon className="h-5 w-5" />
                Export
              </Button>
              <Button onClick={() => void handleCopy()} disabled={json === ''}>
                <CopyIcon className="h-5 w-5" />
                Copy
              </Button>
            </div>

            <textarea
              value={json}
              onChange={(event) => setJson(event.target.value)}
              spellCheck={false}
              placeholder="Export puts your backup here. Or paste one in and import it."
              className={`${INPUT_CLASS} h-32 w-full resize-y py-3 font-mono text-xs`}
            />

            <Button variant="waiting" onClick={() => void handleImport()} disabled={json === ''}>
              Import - replaces everything
            </Button>

            {status.kind === 'ok' ? <p className="text-base text-state-posted">{status.message}</p> : null}
            {status.kind === 'error' ? <p className="text-base text-state-blocked">{status.message}</p> : null}
            {status.kind === 'busy' ? <p className="text-base text-state-later">Working...</p> : null}
          </div>
        </Disclosure>
      </div>
    </section>
  )
}

/** Account and AI key, set once and then not needed day to day: folded,
 *  with who is signed in on the fold. Open when nobody is signed in, since
 *  that is the one time it needs doing. */
function AccountAndKeys() {
  const auth = useAuth()
  if (!auth.configured) return null
  return (
    <Disclosure
      summary="Account and AI key"
      trailing={auth.email ?? 'Not signed in'}
      open={auth.email ? undefined : true}
    >
      <div className="flex flex-col gap-6">
        <Account />
        <AiKeys />
      </div>
    </Disclosure>
  )
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Sign-in, and the only place in the app that ever calls it.
 *
 *  Nothing here is required - the app is local-first and works completely
 *  signed out. An account exists only to sync across devices and to reach
 *  the AI parser, which spends money per call and therefore refuses
 *  anonymous requests (docs/EDGE_FUNCTION.md). Magic-link rather than a
 *  password: nothing to type on a phone beyond an email address, and nothing
 *  to forget. */
function Account() {
  const auth = useAuth()
  const [email, setEmail] = useState('')

  if (!auth.configured) return null

  if (auth.email) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-base text-text-dim">
          Signed in as <span className="text-text">{auth.email}</span>.
        </p>
        <Button onClick={() => void auth.signOut()} className="self-start">
          Sign out
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-base text-text-dim">
        Sign in to sync and to use the contract reader. Everything else works signed out.
      </p>
      <div className="flex gap-2">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          disabled={auth.requestStatus === 'sending' || auth.requestStatus === 'sent'}
          className={`${INPUT_CLASS} min-w-0 flex-1 disabled:text-state-later`}
        />
        <Button
          onClick={() => void auth.requestLink(email)}
          disabled={
            email.trim() === '' || auth.requestStatus === 'sending' || auth.requestStatus === 'sent'
          }
        >
          {auth.requestStatus === 'sending' ? 'Sending...' : 'Send link'}
        </Button>
      </div>
      {auth.requestStatus === 'sent' ? (
        <p className="text-base text-state-posted">Check your email for the sign-in link.</p>
      ) : null}
      {auth.requestStatus === 'error' ? (
        <p className="text-base text-state-blocked">{auth.requestError}</p>
      ) : null}
    </div>
  )
}
