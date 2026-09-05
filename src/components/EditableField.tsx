import { useState } from 'react'

import type { CampaignField } from '../data'
import { MONEY_FIELDS, centsToDollarsInput, parseDollarsToCents } from '../data/campaignFields'
import { fieldLabel } from './fieldLabel'

/** One field, with its provenance visible and a way to fix it.
 *
 *  The parser misses things and gets things wrong, and a value nobody can
 *  correct is worse than a blank - so every field is editable, and editing one
 *  makes it `user_entered` rather than quietly inheriting the authority of a
 *  document it did not come from.
 *
 *  Colour still carries state only: amber for unreviewed, grey for absent,
 *  plain for settled. */
export function EditableField({
  field,
  onSave,
  onConfirm,
}: {
  field: CampaignField
  onSave: (value: string | null) => Promise<void>
  onConfirm?: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isMoney = MONEY_FIELDS.includes(field.field_key)
  const unreviewed = field.source === 'parsed_unreviewed'
  const absent = field.source === 'missing' || field.field_value === null

  function startEditing() {
    const current = field.field_value
    setDraft(
      current !== null && isMoney && /^\d+$/.test(current)
        ? centsToDollarsInput(Number(current))
        : (current ?? ''),
    )
    setError(null)
    setEditing(true)
  }

  async function save() {
    let value: string | null = draft.trim() === '' ? null : draft.trim()

    if (value !== null && isMoney) {
      const cents = parseDollarsToCents(value)
      if (cents === null) {
        setError('Enter an amount like 35 or 35.00.')
        return
      }
      value = String(cents)
    }

    setBusy(true)
    try {
      await onSave(value)
      setEditing(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    if (!onConfirm) return
    setBusy(true)
    try {
      await onConfirm()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className="rounded-lg border border-state-now bg-surface p-3">
        <label
          htmlFor={`edit-${field.field_key}`}
          className="text-xs font-semibold uppercase tracking-wide text-state-later"
        >
          {fieldLabel(field.field_key)}
          {isMoney ? ' (dollars)' : ''}
        </label>
        <input
          id={`edit-${field.field_key}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          inputMode={isMoney ? 'decimal' : 'text'}
          autoFocus
          className="mt-2 min-h-tap w-full rounded-lg border border-edge bg-surface-raised px-3 text-text"
        />
        {error ? <p className="mt-2 text-sm text-state-blocked">{error}</p> : null}
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="min-h-tap flex-1 rounded-lg border border-state-now bg-surface-raised px-4 font-semibold text-state-now active:bg-surface disabled:opacity-60"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={busy}
            className="min-h-tap flex-1 rounded-lg border border-edge bg-surface px-4 font-semibold text-state-later active:bg-surface-raised"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-state-later">{fieldLabel(field.field_key)}</p>
        <p className={unreviewed ? 'text-state-waiting' : absent ? 'text-state-later' : 'text-text'}>
          {absent ? 'not saved yet' : displayValue(field, isMoney)}
        </p>
        {unreviewed && field.source_quote ? (
          <p className="mt-1 text-xs text-state-later">"{field.source_quote}"</p>
        ) : null}
        {!unreviewed && !absent ? (
          <p className="text-xs font-semibold uppercase tracking-wide text-state-later">
            {field.source === 'documented' ? 'documented' : 'you entered this'}
          </p>
        ) : null}
        {error ? <p className="mt-1 text-sm text-state-blocked">{error}</p> : null}
      </div>

      <div className="flex shrink-0 gap-2">
        {unreviewed && onConfirm ? (
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className="min-h-tap rounded-lg border border-state-waiting/50 px-3 text-sm font-semibold text-state-waiting active:bg-surface-raised disabled:opacity-60"
          >
            Confirm
          </button>
        ) : null}
        <button
          type="button"
          onClick={startEditing}
          className="min-h-tap rounded-lg border border-edge px-3 text-sm font-semibold text-state-later active:bg-surface-raised"
        >
          Edit
        </button>
      </div>
    </div>
  )
}

function displayValue(field: CampaignField, isMoney: boolean): string {
  const value = field.field_value ?? ''
  if (isMoney && /^\d+$/.test(value)) return `$${centsToDollarsInput(Number(value))}`
  return value
}
