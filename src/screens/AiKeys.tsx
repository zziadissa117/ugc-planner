import { useCallback, useEffect, useState } from 'react'

import { AI_PROVIDERS, listKeys, maskKey, removeKey, saveKey, type AiProvider, type SavedKey } from '../ai/keys'
import { Button, SectionLabel, StateDot } from '../components/ui'
import { INPUT_CLASS } from '../components/styles'
import { useAuth } from '../sync'

type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string }

/** Where he pastes his own model API key.
 *
 *  The key goes to the server, which checks it with the provider and stores it
 *  encrypted against his account. It never comes back: what is shown for a
 *  saved key is the last four characters, which is all the browser is ever
 *  given. The paste box is emptied the moment the save returns, so the key
 *  does not linger in the page either. */
export function AiKeys() {
  const auth = useAuth()
  if (!auth.configured) return null

  return (
    <div className="flex flex-col gap-3">
      <SectionLabel>AI key</SectionLabel>
      {auth.email ? (
        <>
          <p className="text-base text-text-dim">
            For the contract reader and hook writer. Stored encrypted; only its last four characters are shown.
          </p>
          {AI_PROVIDERS.map((provider) => (
            <ProviderKey key={provider.id} {...provider} />
          ))}
        </>
      ) : (
        <p className="text-base text-text-dim">Sign in above to add your API key.</p>
      )}
    </div>
  )
}

function ProviderKey({ id, label, placeholder }: { id: AiProvider; label: string; placeholder: string }) {
  const [saved, setSaved] = useState<SavedKey | null | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [replacing, setReplacing] = useState(false)

  useEffect(() => {
    let cancelled = false
    void listKeys()
      .then((keys) => {
        if (!cancelled) setSaved(keys.find((key) => key.provider === id) ?? null)
      })
      .catch((error: Error) => {
        if (cancelled) return
        setSaved(null)
        setStatus({ kind: 'error', message: error.message })
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const save = useCallback(async () => {
    setStatus({ kind: 'busy' })
    try {
      const key = await saveKey(id, draft)
      setSaved(key)
      setDraft('')
      setReplacing(false)
      setStatus({ kind: 'ok', message: 'Key checked and saved.' })
    } catch (error) {
      setStatus({ kind: 'error', message: (error as Error).message })
    }
  }, [id, draft])

  const remove = useCallback(async () => {
    setStatus({ kind: 'busy' })
    try {
      await removeKey(id)
      setSaved(null)
      setStatus({ kind: 'ok', message: 'Key removed.' })
    } catch (error) {
      setStatus({ kind: 'error', message: (error as Error).message })
    }
  }, [id])

  if (saved === undefined) return <p className="text-base text-state-later">Loading...</p>

  const showForm = saved === null || replacing

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-tap items-center gap-3">
        <StateDot tone={saved ? 'posted' : 'later'} />
        <span className="text-base text-text">{label}</span>
        <span className="tabular-nums text-base text-text-dim">
          {saved ? maskKey(saved.last4) : 'no key saved'}
        </span>
      </div>

      {showForm ? (
        <div className="flex gap-2">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label={`${label} API key`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={placeholder}
            disabled={status.kind === 'busy'}
            className={`${INPUT_CLASS} min-w-0 flex-1 font-mono`}
          />
          <Button onClick={() => void save()} disabled={draft.trim() === '' || status.kind === 'busy'}>
            {status.kind === 'busy' ? 'Checking...' : 'Save'}
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button onClick={() => setReplacing(true)}>Replace</Button>
          <Button variant="blocked" onClick={() => void remove()} disabled={status.kind === 'busy'}>
            Remove
          </Button>
        </div>
      )}

      {status.kind === 'ok' ? <p className="text-base text-state-posted">{status.message}</p> : null}
      {status.kind === 'error' ? <p className="text-base text-state-blocked">{status.message}</p> : null}
    </div>
  )
}
