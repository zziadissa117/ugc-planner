import { useCallback, useEffect, useState } from 'react'

import { EXPORT_REMINDER_DAYS } from '../data'
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
    <section className="mx-auto flex max-w-screen-sm flex-col gap-6">
      <h1 className="text-2xl font-semibold text-text">Setup</h1>

      {exportIsStale ? (
        <p className="rounded-lg border border-state-waiting/40 bg-state-waiting/10 px-4 py-3 text-state-waiting">
          Your last export is more than {EXPORT_REMINDER_DAYS} days old.
        </p>
      ) : null}

      <Account />

      <TodoList />

      <details className="group">
        <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between text-lg font-semibold text-text">
          Backup
          <span className="text-sm font-normal text-state-later group-open:hidden">Export / import</span>
        </summary>

        <div className="mt-3 flex gap-3">
          <button
            type="button"
            onClick={() => void handleExport()}
            className="min-h-tap flex-1 rounded-lg border border-edge bg-surface px-4 font-semibold text-text active:bg-surface-raised"
          >
            Export
          </button>
          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={json === ''}
            className="min-h-tap flex-1 rounded-lg border border-edge bg-surface px-4 font-semibold text-text active:bg-surface-raised disabled:text-state-later"
          >
            Copy
          </button>
        </div>

        <textarea
          value={json}
          onChange={(event) => setJson(event.target.value)}
          spellCheck={false}
          placeholder="Export puts your backup here. Or paste one in and import it."
          className="mt-3 h-32 w-full resize-y rounded-lg border border-edge bg-surface p-3 font-mono text-xs text-text placeholder:text-state-later"
        />

        <button
          type="button"
          onClick={() => void handleImport()}
          disabled={json === ''}
          className="mt-3 min-h-tap w-full rounded-lg border border-state-waiting/50 bg-surface px-4 font-semibold text-state-waiting active:bg-surface-raised disabled:border-edge disabled:text-state-later"
        >
          Import - replaces everything
        </button>

        {status.kind === 'ok' ? (
          <p className="mt-3 text-state-posted">{status.message}</p>
        ) : null}
        {status.kind === 'error' ? (
          <p className="mt-3 text-state-blocked">{status.message}</p>
        ) : null}
        {status.kind === 'busy' ? <p className="mt-3 text-state-later">Working...</p> : null}
      </details>

      <p className="text-state-later">
        Time estimates and the setup switch cost are only used by the optional planner, and are
        left at their defaults. The reset buttons are not built.
      </p>
    </section>
  )
}

/** A deliberately small device-local scratchpad: useful on set, but never
 * mixed into campaign obligations or the syncable production record. */
function TodoList() {
  const [todos, setTodos] = useState<Todo[]>(() => readTodos())
  const [draft, setDraft] = useState('')

  useEffect(() => {
    localStorage.setItem(TODO_KEY, JSON.stringify(todos))
  }, [todos])

  const add = () => {
    const text = draft.trim()
    if (!text) return
    setTodos((current) => [...current, { id: crypto.randomUUID(), text, done: false }])
    setDraft('')
  }

  const remaining = todos.filter((todo) => !todo.done).length

  return (
    <div className="overflow-hidden rounded-2xl border border-edge bg-surface shadow-[0_12px_36px_rgba(0,0,0,0.18)]">
      <div className="flex items-center justify-between border-b border-edge bg-surface-raised px-4 py-3">
        <div>
          <h2 className="font-semibold text-text">Studio list</h2>
          <p className="text-xs text-text-dim">
            {remaining === 0 ? 'Clear runway.' : `${remaining} thing${remaining === 1 ? '' : 's'} left`}
          </p>
        </div>
        <span className="rounded-full border border-state-waiting/30 bg-state-waiting/10 px-2.5 py-1 text-xs font-semibold text-state-waiting">
          {todos.length}
        </span>
      </div>

      <div className="p-3">
        {todos.length === 0 ? (
          <p className="rounded-xl border border-dashed border-edge px-3 py-5 text-center text-sm text-text-dim">
            Add the next small thing and get it out of your head.
          </p>
        ) : (
          <ul className="space-y-1">
            {todos.map((todo) => (
              <li key={todo.id} className="group flex min-h-11 items-center gap-3 rounded-xl px-2 py-1.5 active:bg-surface-raised">
                <button type="button" aria-label={`Mark ${todo.text} ${todo.done ? 'incomplete' : 'complete'}`} onClick={() => setTodos((current) => current.map((item) => item.id === todo.id ? { ...item, done: !item.done } : item))} className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${todo.done ? 'border-state-posted bg-state-posted text-ink' : 'border-text-dim'}`}>
                  {todo.done ? '✓' : null}
                </button>
                <span className={`min-w-0 flex-1 text-sm ${todo.done ? 'text-text-dim line-through' : 'text-text'}`}>{todo.text}</span>
                <button type="button" aria-label={`Remove ${todo.text}`} onClick={() => setTodos((current) => current.filter((item) => item.id !== todo.id))} className="rounded-lg px-2 py-1 text-text-dim active:bg-ink active:text-text">×</button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex gap-2 border-t border-edge pt-3">
          <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') add() }} placeholder="e.g. Charge the phone rig" className="min-h-tap min-w-0 flex-1 rounded-xl border border-edge bg-ink px-3 text-sm text-text placeholder:text-text-dim" />
          <button type="button" onClick={add} disabled={!draft.trim()} className="min-h-tap rounded-xl bg-state-now px-4 text-sm font-bold text-ink disabled:bg-surface-raised disabled:text-text-dim">Add</button>
        </div>
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
      <div>
        <h2 className="text-lg font-semibold text-text">Account</h2>
        <p className="mt-1 text-state-later">
          Signed in as <span className="text-text">{auth.email}</span>. Syncs across devices, and
          the AI parser can read your documents on the New campaign screen.
        </p>
        <button
          type="button"
          onClick={() => void auth.signOut()}
          className="mt-3 min-h-tap rounded-lg border border-edge bg-surface px-4 font-semibold text-text active:bg-surface-raised"
        >
          Sign out
        </button>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-text">Account</h2>
      <p className="mt-1 text-state-later">
        Sign in to sync across devices and let the AI parser read your campaign documents. Not
        required otherwise - everything works signed out.
      </p>
      <div className="mt-3 flex gap-3">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          disabled={auth.requestStatus === 'sending' || auth.requestStatus === 'sent'}
          className="min-h-tap flex-1 rounded-lg border border-edge bg-surface px-4 text-text placeholder:text-state-later disabled:text-state-later"
        />
        <button
          type="button"
          onClick={() => void auth.requestLink(email)}
          disabled={
            email.trim() === '' || auth.requestStatus === 'sending' || auth.requestStatus === 'sent'
          }
          className="min-h-tap rounded-lg border border-edge bg-surface px-5 font-semibold text-text active:bg-surface-raised disabled:text-state-later"
        >
          {auth.requestStatus === 'sending' ? 'Sending...' : 'Send link'}
        </button>
      </div>
      {auth.requestStatus === 'sent' ? (
        <p className="mt-2 text-state-posted">Check your email for the sign-in link.</p>
      ) : null}
      {auth.requestStatus === 'error' ? (
        <p className="mt-2 text-state-blocked">{auth.requestError}</p>
      ) : null}
    </div>
  )
}
