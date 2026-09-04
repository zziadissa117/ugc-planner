import { useCallback, useEffect, useState } from 'react'

import { EXPORT_REMINDER_DAYS } from '../data'
import { useData } from '../data/useData'

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

      <div>
        <h2 className="text-lg font-semibold text-text">Backup</h2>
        <p className="mt-1 text-state-later">
          Everything the app knows, as JSON. Keep a copy somewhere off this device.
        </p>

        <div className="mt-4 flex gap-3">
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
          className="mt-3 h-64 w-full resize-y rounded-lg border border-edge bg-surface p-3 font-mono text-xs text-text placeholder:text-state-later"
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
      </div>

      <p className="text-state-later">
        Time estimates, the setup switch cost and the reset buttons are not built yet - phase 7 and
        phase 9 add them.
      </p>
    </section>
  )
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
