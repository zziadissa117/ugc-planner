// His income outside UGC on the day - a detailing client, media maxing work -
// typed in as it happens, in USD or CAD, and added into "Made today". Shown
// to the owner only (useIsOwner); a student never sees it.

import { useState } from 'react'

import type { CurrencyCode, SideIncome, SideIncomeSource } from '../data'
import { parseDollarsToCents } from '../data/campaignFields'
import { formatCents } from '../money'
import { CloseIcon, PlusIcon } from './icons'
import { INPUT_CLASS } from './styles'

export const SIDE_INCOME_LABEL: Record<SideIncomeSource, string> = {
  detailing: 'Detailing',
  media_maxing: 'Media Maxing',
}

const CURRENCY_KEY = 'ugc-planner.side_income_currency'

function lastCurrency(): CurrencyCode {
  try {
    return localStorage.getItem(CURRENCY_KEY) === 'USD' ? 'USD' : 'CAD'
  } catch {
    return 'CAD'
  }
}

function Choice<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (next: T) => void
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={[
            'press min-h-tap rounded-full border px-4 text-sm font-semibold',
            value === option.value ? 'border-state-now bg-surface-raised text-text' : 'border-edge text-state-later active:bg-surface',
          ].join(' ')}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function SideIncomeToday({
  entries,
  onAdd,
  onDelete,
}: {
  entries: readonly SideIncome[]
  onAdd: (entry: { source: SideIncomeSource; amount_cents: number; currency: CurrencyCode }) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState<SideIncomeSource>('detailing')
  // Whichever he used last: most days are all one currency.
  const [currency, setCurrency] = useState<CurrencyCode>(lastCurrency)
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    const cents = parseDollarsToCents(amount)
    if (cents === null || cents === 0) {
      setError('Enter an amount, like 180 or 180.50.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onAdd({ source, amount_cents: cents, currency })
      try {
        localStorage.setItem(CURRENCY_KEY, currency)
      } catch {
        // Not remembered; CAD next time.
      }
      setAmount('')
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="-mt-4 flex flex-col gap-3">
      {entries.length > 0 ? (
        <ul aria-label="Other income today" className="flex flex-col divide-y divide-rule border-b border-rule">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 py-2">
              <span className="text-base text-text">{SIDE_INCOME_LABEL[entry.source]}</span>
              <span className="flex items-center gap-2">
                <span className="numeric text-base text-state-posted">
                  {formatCents(entry.amount_cents)} {entry.currency}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${SIDE_INCOME_LABEL[entry.source]} ${formatCents(entry.amount_cents)} ${entry.currency}`}
                  onClick={() => void onDelete(entry.id)}
                  className="press flex size-10 items-center justify-center rounded-full text-state-later active:bg-surface"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <Choice
            label="Where it came from"
            value={source}
            onChange={setSource}
            options={[
              { value: 'detailing', label: SIDE_INCOME_LABEL.detailing },
              { value: 'media_maxing', label: SIDE_INCOME_LABEL.media_maxing },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Amount"
              inputMode="decimal"
              autoFocus
              placeholder="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`${INPUT_CLASS} w-36 text-base`}
            />
            <Choice
              label="Currency"
              value={currency}
              onChange={setCurrency}
              options={[
                { value: 'CAD', label: 'CAD' },
                { value: 'USD', label: 'USD' },
              ]}
            />
          </div>
          {error ? <p className="text-sm text-state-blocked">{error}</p> : null}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="press min-h-tap rounded-full border border-edge-lit px-5 text-sm font-semibold text-text active:bg-surface disabled:opacity-50"
            >
              {saving ? 'Adding…' : 'Add'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setError(null)
              }}
              className="press min-h-tap rounded-full px-4 text-sm font-semibold text-state-later active:bg-surface"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="press flex min-h-tap items-center gap-2 self-start rounded-full border border-edge px-4 text-sm font-semibold text-state-later active:bg-surface"
        >
          <PlusIcon className="h-4 w-4" />
          Add detailing or media maxing
        </button>
      )}
    </div>
  )
}
