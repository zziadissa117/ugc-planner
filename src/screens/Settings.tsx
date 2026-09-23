import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { CheckIcon, CloseIcon, CopyIcon, UploadIcon } from '../components/icons'
import { Button, Disclosure, ScreenHeader, SectionLabel } from '../components/ui'
import { INPUT_CLASS } from '../components/styles'
import { EXPORT_REMINDER_DAYS } from '../data'
import type { Campaign } from '../data'
import { useData } from '../data/useData'
import { useAuth } from '../sync'

type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string }

type Todo = { id: string; text: string; done: boolean }
const TODO_KEY = 'ugc-planner.studio-todos'

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
  // For the studio list below: which line mentions which campaign, so a note
  // he writes about a campaign can jump straight to its brief.
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
    <section className="mx-auto flex max-w-screen-sm flex-col gap-8">
      <ScreenHeader title="Setup" />

      {exportIsStale ? (
        <p className="border-l-2 border-state-waiting pl-3 text-base text-state-waiting">
          Your last export is more than {EXPORT_REMINDER_DAYS} days old.
        </p>
      ) : null}

      <Account />

      <TodoList campaigns={campaigns} />

      <Disclosure summary="Backup" trailing="Export / import" className="border-t">
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

      <p className="meta text-state-later">
        The reset buttons are not built. Nothing else here needs setting.
      </p>
    </section>
  )
}

/** A deliberately small device-local scratchpad: useful on set, but never
 * mixed into campaign obligations or the syncable production record.
 *
 *  He writes lines like "Amboras: create account and do this and that" - his
 *  own shorthand, not a form field, so nothing here asks him to pick a
 *  campaign from a list. A line is matched by campaign name appearing in it
 *  (case-insensitive), and when one does, a small button opens that
 *  campaign's brief straight from the checklist. */
function TodoList({ campaigns }: { campaigns: Campaign[] }) {
  const [todos, setTodos] = useState<Todo[]>(() => readTodos())
  const [draft, setDraft] = useState('')

  const matchFor = useCallback(
    (text: string): Campaign | null => {
      const lower = text.toLowerCase()
      // Longest name first, so "Inflow" cannot steal a match that "Inflow
      // Canada" deserves when both would otherwise match the same line.
      const sorted = [...campaigns].sort((a, b) => b.name.length - a.name.length)
      return sorted.find((c) => c.name.trim() !== '' && lower.includes(c.name.toLowerCase())) ?? null
    },
    [campaigns],
  )

  useEffect(() => {
    try {
      localStorage.setItem(TODO_KEY, JSON.stringify(todos))
    } catch {
      // Private browsing or full storage: the list still works for this visit.
    }
  }, [todos])

  const add = () => {
    const text = draft.trim()
    if (!text) return
    setTodos((current) => [...current, { id: crypto.randomUUID(), text, done: false }])
    setDraft('')
  }

  const remaining = todos.filter((todo) => !todo.done).length

  return (
    <div className="flex flex-col gap-3">
      {/* The count is plain grey text. It used to be an amber pill, and amber
          means waiting on someone or unconfirmed - a to-do count is neither. */}
      <SectionLabel
        trailing={remaining === 0 ? (todos.length === 0 ? undefined : 'clear') : `${remaining} left`}
      >
        Studio list
      </SectionLabel>

      {todos.length === 0 ? (
        <p className="py-2 text-base text-text-dim">Add the next small thing and get it out of your head.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule border-y border-rule">
          {todos.map((todo) => {
            const match = matchFor(todo.text)
            return (
              <li key={todo.id} className="flex min-h-tap items-center gap-3 py-1.5">
                <button
                  type="button"
                  aria-label={`Mark ${todo.text} ${todo.done ? 'incomplete' : 'complete'}`}
                  onClick={() =>
                    setTodos((current) =>
                      current.map((item) => (item.id === todo.id ? { ...item, done: !item.done } : item)),
                    )
                  }
                  className="press -m-2 flex size-11 shrink-0 items-center justify-center"
                >
                  <span
                    className={`flex size-6 items-center justify-center rounded-full border ${
                      todo.done ? 'border-state-posted text-state-posted' : 'border-edge-lit'
                    }`}
                  >
                    {todo.done ? <CheckIcon className="draw-check h-4 w-4" strokeWidth={2.25} /> : null}
                  </span>
                </button>
                <span
                  className={`min-w-0 flex-1 text-base ${todo.done ? 'text-state-later line-through' : 'text-text'}`}
                >
                  {todo.text}
                </span>
                {match ? (
                  <Link
                    to={`/campaigns/${match.id}`}
                    aria-label={`Open the brief for ${match.name}`}
                    className="press shrink-0 rounded-full border border-edge px-3 py-1 text-sm font-semibold text-text-dim active:bg-surface"
                  >
                    {match.name}
                  </Link>
                ) : null}
                <button
                  type="button"
                  aria-label={`Remove ${todo.text}`}
                  onClick={() => setTodos((current) => current.filter((item) => item.id !== todo.id))}
                  className="press -mr-2 flex size-10 shrink-0 items-center justify-center rounded-full text-state-later active:bg-surface"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add()
          }}
          placeholder="e.g. Charge the phone rig"
          className={`${INPUT_CLASS} min-w-0 flex-1`}
        />
        <Button onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
    </div>
  )
}

function readTodos(): Todo[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(TODO_KEY) ?? '[]')
    return Array.isArray(value)
      ? value.filter((item): item is Todo => typeof item === 'object' && item !== null && typeof item.id === 'string' && typeof item.text === 'string' && typeof item.done === 'boolean')
      : []
  } catch {
    return []
  }
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
        <SectionLabel>Account</SectionLabel>
        <p className="text-base text-text-dim">
          Signed in as <span className="text-text">{auth.email}</span>. Syncs across devices, and
          the AI parser can read your documents on the New campaign screen.
        </p>
        <Button onClick={() => void auth.signOut()} className="self-start">
          Sign out
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <SectionLabel>Account</SectionLabel>
      <p className="text-base text-text-dim">
        Sign in to sync across devices and let the AI parser read your campaign documents. Not
        required otherwise - everything works signed out.
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
